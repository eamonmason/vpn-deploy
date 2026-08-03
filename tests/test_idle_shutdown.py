from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import boto3
import pytest

from vpn_toggle import aws_helpers, idle_shutdown

MAX_RUNTIME_MINUTES = 120
GRACE_PERIOD_MINUTES = 15
IDLE_WINDOW_MINUTES = 30
IDLE_BYTE_THRESHOLD_BYTES = 5 * 1024 * 1024


def _check(region, now, **overrides):
    kwargs = {
        "max_runtime_minutes": MAX_RUNTIME_MINUTES,
        "grace_period_minutes": GRACE_PERIOD_MINUTES,
        "idle_window_minutes": IDLE_WINDOW_MINUTES,
        "idle_byte_threshold": IDLE_BYTE_THRESHOLD_BYTES,
    }
    kwargs.update(overrides)
    return idle_shutdown.check_region(region, now, **kwargs)


def _put_network_bytes(region, instance_id, now, metric_bytes):
    cloudwatch = boto3.client("cloudwatch", region_name=region)
    for metric_name, value in metric_bytes.items():
        cloudwatch.put_metric_data(
            Namespace="AWS/EC2",
            MetricData=[
                {
                    "MetricName": metric_name,
                    "Dimensions": [{"Name": "InstanceId", "Value": instance_id}],
                    "Timestamp": now - timedelta(minutes=5),
                    "Value": value,
                    "Unit": "Bytes",
                }
            ],
        )


def test_check_region_leaves_off_instance_alone(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=0)

    should_stop, reason, detail = _check("eu-west-1", datetime.now(UTC))

    assert should_stop is False
    assert reason is None
    assert detail == {}


def test_check_region_leaves_freshly_launched_instance_alone(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES - 1)

    should_stop, reason, detail = _check("eu-west-1", now)

    assert should_stop is False
    assert reason is None
    assert detail["uptime_minutes"] == pytest.approx(GRACE_PERIOD_MINUTES - 1, abs=0.1)


def test_check_region_stops_for_max_runtime_cap_even_with_heavy_traffic(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC) + timedelta(minutes=MAX_RUNTIME_MINUTES)
    _put_network_bytes("eu-west-1", instance_id, now, {"NetworkIn": 50 * 1024 * 1024})

    should_stop, reason, detail = _check("eu-west-1", now)

    assert should_stop is True
    assert reason == "max-runtime-cap"
    assert detail["uptime_minutes"] == pytest.approx(MAX_RUNTIME_MINUTES, abs=0.1)


def test_check_region_stops_when_idle_past_grace_period(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES + 5)
    _put_network_bytes("eu-west-1", instance_id, now, {"NetworkIn": 100, "NetworkOut": 100})

    should_stop, reason, detail = _check("eu-west-1", now)

    assert should_stop is True
    assert reason == "idle-timeout"
    assert detail["bytes_transferred"] == 200


def test_check_region_leaves_active_instance_running(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES + 5)
    _put_network_bytes(
        "eu-west-1", instance_id, now, {"NetworkIn": IDLE_BYTE_THRESHOLD_BYTES * 2}
    )

    should_stop, reason, detail = _check("eu-west-1", now)

    assert should_stop is False
    assert reason is None
    assert detail["bytes_transferred"] == IDLE_BYTE_THRESHOLD_BYTES * 2


def test_check_region_fails_safe_when_no_cloudwatch_datapoints_yet(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES + 5)

    should_stop, reason, detail = _check("eu-west-1", now)

    assert should_stop is False
    assert reason is None
    assert "bytes_transferred" not in detail


def test_get_network_bytes_sum_returns_none_without_datapoints(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)

    assert aws_helpers.get_network_bytes_sum(instance_id, "eu-west-1", 30) is None


def test_get_network_bytes_sum_sums_in_and_out(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    now = datetime.now(UTC)
    _put_network_bytes("eu-west-1", instance_id, now, {"NetworkIn": 1000, "NetworkOut": 2000})

    total = aws_helpers.get_network_bytes_sum(instance_id, "eu-west-1", 30)

    assert total == 3000


def test_publish_notification_delivers_to_subscribed_queue(aws):
    sns = boto3.client("sns", region_name="eu-west-1")
    sqs = boto3.client("sqs", region_name="eu-west-1")
    topic_arn = sns.create_topic(Name="vpn-auto-stop-notifications")["TopicArn"]
    queue_url = sqs.create_queue(QueueName="test-queue")["QueueUrl"]
    queue_arn = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["QueueArn"])[
        "Attributes"
    ]["QueueArn"]
    sns.subscribe(TopicArn=topic_arn, Protocol="sqs", Endpoint=queue_arn)

    aws_helpers.publish_notification(topic_arn, "VPN auto-stopped in eu-west-1", "idle-timeout")

    messages = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=1)["Messages"]
    assert len(messages) == 1
    assert "idle-timeout" in messages[0]["Body"]


def test_handler_stops_idle_region_and_notifies(aws, make_wireguard_asg, monkeypatch):
    monkeypatch.setattr(idle_shutdown, "VALID_ZONES", ["eu-west-1", "us-east-1"])
    monkeypatch.setenv("NOTIFICATION_TOPIC_ARN", "arn:aws:sns:eu-west-1:123456789012:vpn-auto-stop-notifications")

    _, idle_instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    make_wireguard_asg(region="us-east-1", desired_capacity=0)

    fixed_now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES + 5)
    _put_network_bytes("eu-west-1", idle_instance_id, fixed_now, {"NetworkIn": 10})

    notifications = []
    monkeypatch.setattr(
        idle_shutdown,
        "publish_notification",
        lambda topic_arn, subject, message: notifications.append((subject, message)),
    )

    with patch("vpn_toggle.idle_shutdown.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        result = idle_shutdown.handler()

    assert result == {"stopped_regions": ["eu-west-1"]}
    assert aws_helpers.get_asg("eu-west-1").DesiredCapacity == 0
    assert len(notifications) == 1
    assert "idle-timeout" in notifications[0][0]


def test_handler_continues_past_a_region_that_errors(aws, make_wireguard_asg, monkeypatch):
    monkeypatch.setattr(idle_shutdown, "VALID_ZONES", ["eu-west-1", "us-east-1"])
    monkeypatch.setenv("NOTIFICATION_TOPIC_ARN", "arn:aws:sns:eu-west-1:123456789012:vpn-auto-stop-notifications")

    _, idle_instance_id = make_wireguard_asg(region="us-east-1", desired_capacity=1)
    fixed_now = datetime.now(UTC) + timedelta(minutes=GRACE_PERIOD_MINUTES + 5)
    _put_network_bytes("us-east-1", idle_instance_id, fixed_now, {"NetworkIn": 10})

    def broken_get_asg(region):
        if region == "eu-west-1":
            raise RuntimeError("transient AWS error")
        return aws_helpers.get_asg(region)

    monkeypatch.setattr(idle_shutdown, "get_asg", broken_get_asg)
    monkeypatch.setattr(
        idle_shutdown, "publish_notification", lambda *args, **kwargs: None
    )

    with patch("vpn_toggle.idle_shutdown.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        result = idle_shutdown.handler()

    assert result == {"stopped_regions": ["us-east-1"]}
