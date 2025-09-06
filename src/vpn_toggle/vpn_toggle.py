"""
Lambda function to toggle VPN on or off across defined regions.
"""

import json
import logging
import logging.config
import os
import sys
import time
from typing import Optional
from urllib import request

from pydantic import BaseModel

from .aws_helpers import (
    get_asg,
    get_instance_from_asg,
    set_dns_alias,
    update_asg_capacity,
    update_security_group,
)

VALID_ZONES = ["us-east-1", "eu-north-1", "eu-west-2", "ap-southeast-2"]
# create least privilegd role for this feature

if len(logging.getLogger().handlers) > 0:
    logging.getLogger().setLevel(logging.INFO)
else:
    logging.basicConfig(
        level=logging.DEBUG, format="%(asctime)s %(levelname)s:%(message)s"
    )
logging.getLogger("botocore").setLevel(logging.INFO)
logging.getLogger("boto3").setLevel(logging.INFO)
logging.getLogger("urllib3").setLevel(logging.INFO)
logger = logging.getLogger(__name__)


class VpnEvent(BaseModel):
    region: str
    whitelist_ip: str


class SnsMessage(BaseModel):
    Message: str


class SnsEvent(BaseModel):
    Records: list[dict]


class LambdaContext(BaseModel):
    function_name: str
    function_version: str


def enable_vpn(asg, region: str, a_record: str, hosted_zone_name: str, client_ip: str):
    """Enables VPN by setting the ASG capacity to 1."""
    new_capacity = update_asg_capacity(asg, region, 1)
    if new_capacity == 1:
        logger.debug("Waiting for the VPN VM to start in region %s", region)
        # Check ASG if VM is available, up to five times
        for _ in range(5):
            up_asg = get_asg(region)
            try:
                instance = get_instance_from_asg(up_asg, region)
                if instance.State["Name"].lower() != "running":
                    logger.info("Waiting for instance to start...")
                    time.sleep(5)
                else:
                    break
            except ValueError:
                logger.info("Waiting for instance to start...")
                time.sleep(5)

        set_dns_alias(a_record, hosted_zone_name, asg, region)
        update_security_group(asg, client_ip, region)
    else:
        logger.debug("VPN not enabled in region %s", region)


def disable_vpn(asg, region: str):
    """Disables VPN by setting the ASG capacity to 0."""
    update_asg_capacity(asg, region, 0)


def manage_vpn(
    target_region: str, a_record_name: str, hosted_zone_name: str, whitelist_ip: str
):
    """Main function"""
    if target_region not in VALID_ZONES and target_region != "none":
        raise ValueError(
            f"Invalid region {target_region}. Valid regions are {VALID_ZONES} or 'none'"
        )
    for region in VALID_ZONES:
        asg = get_asg(region)
        if region == target_region:
            logger.info("Enabling VPN in %s", region)
            enable_vpn(asg, region, a_record_name, hosted_zone_name, whitelist_ip)
        else:
            logger.info("Disabling VPN in %s", region)
            disable_vpn(asg, region)


def handler(event: dict, context: Optional[dict] = None):
    """Lambda handler"""
    a_record_name = os.environ["A_RECORD_NAME"]
    domain_name = os.environ["DOMAIN_NAME"]
    target_region = None
    whitelist_ip = None

    try:
        if "region" in event and "whitelist_ip" in event:
            vpn_event = VpnEvent(**event)
            target_region = vpn_event.region
            whitelist_ip = vpn_event.whitelist_ip
        elif "Records" in event:
            sns_event = SnsEvent(**event)
            message = json.loads(sns_event.Records[0]["Sns"]["Message"])
            vpn_event = VpnEvent(**message)
            target_region = vpn_event.region
            whitelist_ip = vpn_event.whitelist_ip
        else:
            raise ValueError("Missing region or whitelist_ip in event")

        if a_record_name and domain_name and target_region and whitelist_ip:
            manage_vpn(target_region, a_record_name, domain_name, whitelist_ip)
        else:
            raise ValueError("Missing environment variables or region")
    except Exception as e:
        logger.error(f"Error processing event: {e}")
        raise


if __name__ == "__main__":
    if len(sys.argv) >= 4:
        aws_region = sys.argv[1]
        vpn_alias = sys.argv[2]
        zone_name = sys.argv[3]
        cli_whitelist_ip = (
            request.urlopen("https://api.ipify.org").read().decode("utf8")
        )
    else:
        print(
            """Usage: python3 vpn_toggle.py <aws_region> <vpn_alias> <zone_name>
            (set region to 'none' for switching all off)"""
        )
        sys.exit(1)

    manage_vpn(aws_region, vpn_alias, zone_name, cli_whitelist_ip)
