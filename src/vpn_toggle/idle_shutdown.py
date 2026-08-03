"""
Lambda function, run on a schedule, that auto-stops VPN instances which have either
been idle (near-zero network traffic) for a while, or exceeded a hard runtime cap -
so a forgotten VPN doesn't rack up compute costs indefinitely.
"""

import logging
import os
from datetime import UTC, datetime

from .aws_helpers import (
    get_asg,
    get_instance_from_asg,
    get_network_bytes_sum,
    publish_notification,
    update_asg_capacity,
)
from .vpn_toggle import VALID_ZONES

DEFAULT_MAX_RUNTIME_MINUTES = 120
DEFAULT_GRACE_PERIOD_MINUTES = 15
DEFAULT_IDLE_WINDOW_MINUTES = 30
DEFAULT_IDLE_BYTE_THRESHOLD_BYTES = 5 * 1024 * 1024

if len(logging.getLogger().handlers) > 0:
    logging.getLogger().setLevel(logging.INFO)
else:
    logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s:%(message)s")
logging.getLogger("botocore").setLevel(logging.INFO)
logging.getLogger("boto3").setLevel(logging.INFO)
logging.getLogger("urllib3").setLevel(logging.INFO)
logger = logging.getLogger(__name__)


def check_region(
    region: str,
    now: datetime,
    max_runtime_minutes: int,
    grace_period_minutes: int,
    idle_window_minutes: int,
    idle_byte_threshold: int,
) -> tuple[bool, str | None, dict]:
    """
    Decides whether a region's VPN instance should be auto-stopped.
    Does not mutate any state - the caller acts on the result.
    @return: (should_stop, reason, detail)
    """
    asg = get_asg(region)
    if asg.DesiredCapacity != 1:
        return False, None, {}

    try:
        instance = get_instance_from_asg(asg, region)
    except ValueError:
        # ASG is scaling in/out; no instance attached yet.
        return False, None, {}

    if instance.State["Name"].lower() != "running":
        return False, None, {}

    uptime_minutes = (now - instance.LaunchTime).total_seconds() / 60
    detail = {"uptime_minutes": uptime_minutes}

    if uptime_minutes >= max_runtime_minutes:
        return True, "max-runtime-cap", detail

    if uptime_minutes < grace_period_minutes:
        return False, None, detail

    bytes_transferred = get_network_bytes_sum(instance.InstanceId, region, idle_window_minutes, end_time=now)
    if bytes_transferred is None:
        # No CloudWatch datapoints yet - fail safe, don't guess that it's idle.
        return False, None, detail
    detail["bytes_transferred"] = bytes_transferred

    if bytes_transferred < idle_byte_threshold:
        return True, "idle-timeout", detail

    return False, None, detail


def _format_message(region: str, reason: str, detail: dict) -> str:
    uptime_minutes = detail.get("uptime_minutes")
    lines = [f"VPN in region {region} was automatically stopped."]
    if reason == "max-runtime-cap":
        lines.append(f"Reason: it had been running for {uptime_minutes:.0f} minutes, exceeding the max runtime cap.")
    else:
        bytes_transferred = detail.get("bytes_transferred", 0)
        lines.append(
            f"Reason: only {bytes_transferred} bytes transferred while running for "
            f"{uptime_minutes:.0f} minutes, indicating it was idle."
        )
    lines.append("Start it again from the usual API/shortcut when you next need it.")
    return "\n".join(lines)


def handler(event: dict | None = None, context: dict | None = None):
    """Lambda handler, invoked on an EventBridge schedule."""
    topic_arn = os.environ["NOTIFICATION_TOPIC_ARN"]
    max_runtime_minutes = int(os.environ.get("MAX_RUNTIME_MINUTES", DEFAULT_MAX_RUNTIME_MINUTES))
    grace_period_minutes = int(os.environ.get("GRACE_PERIOD_MINUTES", DEFAULT_GRACE_PERIOD_MINUTES))
    idle_window_minutes = int(os.environ.get("IDLE_WINDOW_MINUTES", DEFAULT_IDLE_WINDOW_MINUTES))
    idle_byte_threshold = int(os.environ.get("IDLE_BYTE_THRESHOLD_BYTES", DEFAULT_IDLE_BYTE_THRESHOLD_BYTES))

    now = datetime.now(UTC)
    stopped_regions = []

    for region in VALID_ZONES:
        try:
            should_stop, reason, detail = check_region(
                region, now, max_runtime_minutes, grace_period_minutes, idle_window_minutes, idle_byte_threshold
            )
        except Exception:
            logger.exception("Error checking region %s for idle shutdown", region)
            continue

        if not should_stop:
            continue

        try:
            asg = get_asg(region)
            update_asg_capacity(asg, region, 0)
            publish_notification(
                topic_arn,
                subject=f"VPN auto-stopped in {region} ({reason})",
                message=_format_message(region, reason, detail),
            )
            stopped_regions.append(region)
            logger.info("Auto-stopped VPN in %s (%s): %s", region, reason, detail)
        except Exception:
            logger.exception("Error auto-stopping region %s", region)

    return {"stopped_regions": stopped_regions}
