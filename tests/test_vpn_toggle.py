from unittest.mock import MagicMock

import boto3
import pytest

from vpn_toggle import aws_helpers, vpn_toggle


def test_get_asg_finds_tagged_asg_and_ignores_untagged(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=0)
    asg = aws_helpers.get_asg("eu-west-1")
    assert asg.AutoScalingGroupName == "wireguard-asg-eu-west-1"
    assert asg.DesiredCapacity == 0


def test_get_asg_raises_when_no_tagged_asg_exists(aws):
    with pytest.raises(IndexError):
        aws_helpers.get_asg("eu-west-1")


def test_update_asg_capacity_is_a_noop_when_already_at_target(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    asg = aws_helpers.get_asg("eu-west-1")

    result = aws_helpers.update_asg_capacity(asg, "eu-west-1", 1)

    assert result == 1
    unchanged = aws_helpers.get_asg("eu-west-1")
    assert unchanged.DesiredCapacity == 1


def test_update_asg_capacity_changes_capacity(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    asg = aws_helpers.get_asg("eu-west-1")

    aws_helpers.update_asg_capacity(asg, "eu-west-1", 0)

    updated = aws_helpers.get_asg("eu-west-1")
    assert updated.DesiredCapacity == 0


def test_get_instance_from_asg_returns_launch_time(aws, make_wireguard_asg):
    _, instance_id = make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    asg = aws_helpers.get_asg("eu-west-1")

    instance = aws_helpers.get_instance_from_asg(asg, "eu-west-1")

    assert instance.InstanceId == instance_id
    assert instance.LaunchTime is not None


def test_get_instance_from_asg_raises_when_no_instance_attached(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=0)
    asg = aws_helpers.get_asg("eu-west-1")

    with pytest.raises(ValueError):
        aws_helpers.get_instance_from_asg(asg, "eu-west-1")


def test_manage_vpn_enables_target_region_and_disables_all_others(monkeypatch):
    monkeypatch.setattr(vpn_toggle, "VALID_ZONES", ["eu-west-1", "us-east-1", "eu-west-2"])
    monkeypatch.setattr(vpn_toggle, "get_asg", lambda region: MagicMock(name=region))
    enable_calls = []
    disable_calls = []
    monkeypatch.setattr(vpn_toggle, "enable_vpn", lambda asg, region, *a, **k: enable_calls.append(region))
    monkeypatch.setattr(vpn_toggle, "disable_vpn", lambda asg, region: disable_calls.append(region))

    vpn_toggle.manage_vpn("us-east-1", "vpn.example.com", "example.com", "1.2.3.4")

    assert enable_calls == ["us-east-1"]
    assert disable_calls == ["eu-west-1", "eu-west-2"]


def test_manage_vpn_none_disables_every_region(monkeypatch):
    monkeypatch.setattr(vpn_toggle, "VALID_ZONES", ["eu-west-1", "us-east-1"])
    monkeypatch.setattr(vpn_toggle, "get_asg", lambda region: MagicMock(name=region))
    disable_calls = []
    monkeypatch.setattr(vpn_toggle, "enable_vpn", lambda *a, **k: pytest.fail("should not enable any region"))
    monkeypatch.setattr(vpn_toggle, "disable_vpn", lambda asg, region: disable_calls.append(region))

    vpn_toggle.manage_vpn("none", "vpn.example.com", "example.com", "1.2.3.4")

    assert disable_calls == ["eu-west-1", "us-east-1"]


def test_manage_vpn_raises_on_invalid_region(monkeypatch):
    monkeypatch.setattr(vpn_toggle, "VALID_ZONES", ["eu-west-1", "us-east-1"])

    with pytest.raises(ValueError):
        vpn_toggle.manage_vpn("mars-central-1", "vpn.example.com", "example.com", "1.2.3.4")


def test_enable_vpn_sets_capacity_and_updates_dns_and_security_group(
    aws, make_wireguard_asg, hosted_zone
):
    make_wireguard_asg(region="eu-west-1", desired_capacity=0)
    asg = aws_helpers.get_asg("eu-west-1")

    vpn_toggle.enable_vpn(asg, "eu-west-1", "vpn.example.com", "example.com", "1.2.3.4")

    updated = aws_helpers.get_asg("eu-west-1")
    assert updated.DesiredCapacity == 1


def test_update_security_group_keeps_world_open_ports_and_clamps_ssh(
    aws, make_wireguard_asg
):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    asg = aws_helpers.get_asg("eu-west-1")

    aws_helpers.update_security_group(asg, "9.9.9.9", "eu-west-1")

    instance = aws_helpers.get_instance_from_asg(asg, "eu-west-1")
    ec2 = boto3.client("ec2", region_name="eu-west-1")
    security_group = ec2.describe_security_groups(
        GroupIds=[instance.SecurityGroups[0]["GroupId"]]
    )["SecurityGroups"][0]
    rules = {
        (p["IpProtocol"], p["FromPort"]): [r["CidrIp"] for r in p["IpRanges"]]
        for p in security_group["IpPermissions"]
    }

    assert rules[("udp", 51820)] == ["0.0.0.0/0"]
    assert rules[("tcp", 51413)] == ["0.0.0.0/0"]
    assert rules[("udp", 51413)] == ["0.0.0.0/0"]
    assert rules[("tcp", 22)] == ["9.9.9.9/32"]


def test_disable_vpn_sets_capacity_to_zero(aws, make_wireguard_asg):
    make_wireguard_asg(region="eu-west-1", desired_capacity=1)
    asg = aws_helpers.get_asg("eu-west-1")

    vpn_toggle.disable_vpn(asg, "eu-west-1")

    updated = aws_helpers.get_asg("eu-west-1")
    assert updated.DesiredCapacity == 0


def test_handler_direct_invoke_calls_manage_vpn(monkeypatch):
    calls = []
    monkeypatch.setattr(vpn_toggle, "manage_vpn", lambda *args: calls.append(args))
    monkeypatch.setenv("A_RECORD_NAME", "vpn.example.com")
    monkeypatch.setenv("DOMAIN_NAME", "example.com")

    vpn_toggle.handler({"region": "eu-west-1", "whitelist_ip": "1.2.3.4"})

    assert calls == [("eu-west-1", "vpn.example.com", "example.com", "1.2.3.4")]


def test_handler_sns_event_unwraps_message_and_calls_manage_vpn(monkeypatch):
    calls = []
    monkeypatch.setattr(vpn_toggle, "manage_vpn", lambda *args: calls.append(args))
    monkeypatch.setenv("A_RECORD_NAME", "vpn.example.com")
    monkeypatch.setenv("DOMAIN_NAME", "example.com")

    event = {
        "Records": [
            {"Sns": {"Message": '{"region": "us-east-1", "whitelist_ip": "5.6.7.8"}'}}
        ]
    }
    vpn_toggle.handler(event)

    assert calls == [("us-east-1", "vpn.example.com", "example.com", "5.6.7.8")]


def test_handler_raises_when_required_env_vars_missing(monkeypatch):
    monkeypatch.delenv("A_RECORD_NAME", raising=False)
    monkeypatch.delenv("DOMAIN_NAME", raising=False)

    with pytest.raises(KeyError):
        vpn_toggle.handler({"region": "eu-west-1", "whitelist_ip": "1.2.3.4"})


def test_handler_raises_on_event_missing_region_or_ip(monkeypatch):
    monkeypatch.setenv("A_RECORD_NAME", "vpn.example.com")
    monkeypatch.setenv("DOMAIN_NAME", "example.com")

    with pytest.raises(ValueError):
        vpn_toggle.handler({"something": "else"})
