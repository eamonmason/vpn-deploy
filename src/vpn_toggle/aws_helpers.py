"""
Helper functions for interacting with AWS.
"""

import logging
from typing import List

import boto3
from pydantic import BaseModel

APPLICATION_NAME_KEY = "application-name"
APPLICATION_NAME_VALUE = "wireguard-vpn"

if len(logging.getLogger().handlers) > 0:
    logging.getLogger().setLevel(logging.INFO)
else:
    logging.basicConfig(
        level=logging.DEBUG, format="%(asctime)s %(levelname)s:%(message)s"
    )
logger = logging.getLogger(__name__)


class SecurityGroupRule(BaseModel):
    IpProtocol: str
    FromPort: int
    ToPort: int
    IpRanges: List[dict]


class SecurityGroup(BaseModel):
    GroupId: str
    IpPermissions: List[SecurityGroupRule]


class AutoScalingGroup(BaseModel):
    AutoScalingGroupName: str
    DesiredCapacity: int


class Ec2Instance(BaseModel):
    InstanceId: str
    State: dict
    SecurityGroups: List[dict]
    NetworkInterfaces: List[dict]


def get_asg(aws_region: str) -> AutoScalingGroup:
    """
    Gets the ASG for the VPN.
    @param aws_region: The AWS region to use
    @return: The ASG object
    """
    client = boto3.client("autoscaling", region_name=aws_region)
    response = client.describe_auto_scaling_groups(
        Filters=[
            {"Name": f"tag:{APPLICATION_NAME_KEY}", "Values": [APPLICATION_NAME_VALUE]},
        ]
    )
    return AutoScalingGroup(**response["AutoScalingGroups"][0])


def update_asg_capacity(
    asg: AutoScalingGroup, region: str, desired_capacity: int
) -> int:
    """
    Toggles the ASG to have an instance on or off.
    @param asg: The ASG to toggle
    @return: The new capacity setting of the ASG (either 0 or 1)
    """
    client = boto3.client("autoscaling", region_name=region)
    current_capacity = asg.DesiredCapacity
    if desired_capacity != current_capacity:
        logger.debug(
            "Updating ASG capacity to %s in region %s", desired_capacity, region
        )
        client.update_auto_scaling_group(
            AutoScalingGroupName=asg.AutoScalingGroupName,
            DesiredCapacity=desired_capacity,
        )
    else:
        logger.debug(
            "ASG capacity is already %s in region %s", desired_capacity, region
        )
    return desired_capacity


def _get_instance_public_ip(asg: AutoScalingGroup, region) -> str:
    """Gets the public IP address of the instance."""
    instance_ec2 = get_instance_from_asg(asg, region)
    return instance_ec2.NetworkInterfaces[0]["Association"]["PublicIp"]


def get_instance_from_asg(asg: AutoScalingGroup, region: str) -> Ec2Instance:
    """Gets the EC2 instance details from the ASG."""
    asg_client = boto3.client("autoscaling", region_name=region)
    response = asg_client.describe_auto_scaling_instances()
    vm_instance_id = None
    for instance in response["AutoScalingInstances"]:
        if instance["AutoScalingGroupName"] == asg.AutoScalingGroupName:
            vm_instance_id = instance["InstanceId"]
            break
    if vm_instance_id is not None:
        client = boto3.client("ec2", region_name=region)
        response = client.describe_instances(InstanceIds=[vm_instance_id])
        return Ec2Instance(**response["Reservations"][0]["Instances"][0])
    else:
        raise ValueError(f"No instance found for {asg.AutoScalingGroupName}")


def update_security_group(
    asg: AutoScalingGroup, allowed_client_ip: str, region_name: str
) -> None:
    """
    Updates the security group to allow traffic from the given IP address.
    """
    instance_ec2 = get_instance_from_asg(asg, region_name)
    ec2 = boto3.client("ec2", region_name=region_name)
    security_group_id = instance_ec2.SecurityGroups[0]["GroupId"]
    security_group = ec2.describe_security_groups(GroupIds=[security_group_id])[
        "SecurityGroups"
    ][0]
    permissions = security_group["IpPermissions"]
    authorize_permissions = []
    for p in permissions:
        q = p.copy()
        q["IpRanges"] = [{"CidrIp": f"{allowed_client_ip}/32"}]
        authorize_permissions.append(q)
    if (
        len(permissions) > 0
        and len(authorize_permissions) > 0
        and permissions != authorize_permissions
    ):
        ec2.revoke_security_group_ingress(
            GroupId=security_group_id, IpPermissions=permissions
        )
        ec2.authorize_security_group_ingress(
            GroupId=security_group_id, IpPermissions=authorize_permissions
        )
    else:
        logger.info("No security group changes needed")


def set_dns_alias(
    alias_name: str, hosted_zone_name: str, asg: AutoScalingGroup, region: str
) -> dict:
    """
    Sets the DNS alias to point to the given IP address.
    """
    action = "CREATE"
    ip_address = _get_instance_public_ip(asg, region)
    logger.debug("Setting DNS alias %s to %s", alias_name, ip_address)
    client = boto3.client("route53")
    hosted_zone_id = client.list_hosted_zones_by_name(DNSName=hosted_zone_name)[
        "HostedZones"
    ][0]["Id"]
    for r in client.list_resource_record_sets(HostedZoneId=hosted_zone_id)[
        "ResourceRecordSets"
    ]:
        if r["Name"] == alias_name + ".":
            action = "UPSERT"
            break

    return client.change_resource_record_sets(
        ChangeBatch={
            "Changes": [
                {
                    "Action": action,
                    "ResourceRecordSet": {
                        "Name": alias_name,
                        "ResourceRecords": [
                            {
                                "Value": ip_address,
                            },
                        ],
                        "TTL": 60,
                        "Type": "A",
                    },
                },
            ],
            "Comment": "VPN A record",
        },
        HostedZoneId=hosted_zone_id,
    )
