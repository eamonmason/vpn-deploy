"""
Lambda function to toggle VPN on or off across defined regions.
"""
import logging
import logging.config
import os
import sys
import time
from urllib import request

from .aws_helpers import (get_asg, get_instance_from_asg, set_dns_alias,
                          update_asg_capacity, update_security_group)

PUBLIC_IP_URL = 'https://ifconfig.me'
VALID_ZONES = ['us-east-1', 'eu-north-1', 'eu-west-2']
# create least privilegd role for this feature

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s %(levelname)s:%(message)s')
logging.getLogger('botocore').setLevel(logging.INFO)
logging.getLogger('boto3').setLevel(logging.INFO)
logging.getLogger('urllib3').setLevel(logging.INFO)
logger = logging.getLogger(__name__)


def get_local_public_ip() -> str:
    """Gets the public IP address of the local machine."""
    return request.urlopen(PUBLIC_IP_URL).read().decode('utf8')


def enable_vpn(asg, region: str, a_record: str, hosted_zone_name: str):
    """Enables VPN by setting the ASG capacity to 1."""
    new_capacity = update_asg_capacity(asg, region, 1)
    if new_capacity == 1:
        logger.debug("Waiting for the VPN VM to start in region %s", region)
        # Check ASG if VM is available, up to five times
        for _ in range(5):
            up_asg = get_asg(region)
            try:
                instance = get_instance_from_asg(up_asg, region)
                if instance["State"]["Name"].lower() != "running":
                    logger.warning("Waiting for instance to start...")
                    time.sleep(5)
                else:
                    break
            except ValueError:
                logger.warning("Waiting for instance to start...")
                time.sleep(5)

        set_dns_alias(a_record, hosted_zone_name, asg, region)
        client_ip = get_local_public_ip()
        update_security_group(asg, client_ip, region_name=region)
    else:
        logger.debug("VPN not enabled in region %s", region)


def disable_vpn(asg, region: str):
    """Disables VPN by setting the ASG capacity to 0."""
    update_asg_capacity(asg, region, 0)


def manage_vpn(target_region: str, a_record_name: str, hosted_zone_name: str):
    """Main function"""
    if target_region not in VALID_ZONES and target_region != "none":
        raise ValueError(
            f"Invalid region {target_region}. Valid regions are {VALID_ZONES} or 'none'")
    for region in VALID_ZONES:
        asg = get_asg(region)
        if region == target_region:
            logger.info("Enabling VPN in %s", region)
            enable_vpn(asg, region, a_record_name, hosted_zone_name)
        else:
            logger.info("Disabling VPN in %s", region)
            disable_vpn(asg, region)


def handler(event, context):  # pylint: disable=unused-argument
    """Lambda handler"""
    a_record_name = os.environ("A_RECORD_NAME")
    domain_name = os.environ("DOMAIN_NAME")
    target_region = event["region"]
    if a_record_name and domain_name and target_region:
        manage_vpn(target_region, a_record_name, domain_name)
    else:
        raise ValueError("Missing environment variables or region")


if __name__ == '__main__':
    if len(sys.argv) >= 4:
        aws_region = sys.argv[1]
        vpn_alias = sys.argv[2]
        zone_name = sys.argv[3]
    else:
        print(
            """Usage: python3 vpn_toggle.py <aws_region> <vpn_alias> <zone_name>
            (set region to 'none' for switching all off)""")
        sys.exit(1)

    manage_vpn(aws_region, vpn_alias, zone_name)
