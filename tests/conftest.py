import os

import boto3
import pytest
from moto import mock_aws


@pytest.fixture(autouse=True)
def aws_credentials():
    """Moto requires *some* credentials to be present, even though it never calls real AWS."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "eu-west-1"


@pytest.fixture
def aws(aws_credentials):
    """Activates a moto mock covering every AWS service vpn_toggle/idle_shutdown touch."""
    with mock_aws():
        yield


@pytest.fixture
def make_wireguard_asg(aws):
    """
    Factory fixture: creates a minimal VPC + launch template + tagged ASG (mirroring what
    lib/vpn-vm-deploy-stack.ts deploys) in the given region, optionally with a running
    instance attached (when desired_capacity > 0).
    @return: a function (region, desired_capacity) -> (asg_name, instance_id | None)
    """

    def _make(region: str = "eu-west-1", desired_capacity: int = 1):
        ec2 = boto3.client("ec2", region_name=region)
        asg_client = boto3.client("autoscaling", region_name=region)

        vpc_id = ec2.create_vpc(CidrBlock="172.32.0.0/16")["Vpc"]["VpcId"]
        subnet_id = ec2.create_subnet(VpcId=vpc_id, CidrBlock="172.32.0.0/28")["Subnet"]["SubnetId"]
        ec2.modify_subnet_attribute(SubnetId=subnet_id, MapPublicIpOnLaunch={"Value": True})
        security_group_id = ec2.create_security_group(
            GroupName=f"wireguard-sg-{region}", Description="wireguard", VpcId=vpc_id
        )["GroupId"]
        ec2.authorize_security_group_ingress(
            GroupId=security_group_id,
            IpPermissions=[
                {"IpProtocol": "udp", "FromPort": 51820, "ToPort": 51820, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]},
                {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "1.2.3.4/32"}]},
            ],
        )
        ec2.create_launch_template(
            LaunchTemplateName=f"wireguard-lt-{region}",
            LaunchTemplateData={
                "ImageId": "ami-12345678",
                "InstanceType": "t3.micro",
                "SecurityGroupIds": [security_group_id],
            },
        )

        asg_name = f"wireguard-asg-{region}"
        asg_client.create_auto_scaling_group(
            AutoScalingGroupName=asg_name,
            LaunchTemplate={"LaunchTemplateName": f"wireguard-lt-{region}", "Version": "$Latest"},
            MinSize=0,
            MaxSize=1,
            DesiredCapacity=desired_capacity,
            VPCZoneIdentifier=subnet_id,
            Tags=[
                {
                    "Key": "application-name",
                    "Value": "wireguard-vpn",
                    "PropagateAtLaunch": True,
                    "ResourceId": asg_name,
                    "ResourceType": "auto-scaling-group",
                }
            ],
        )

        instance_id = None
        if desired_capacity > 0:
            instances = asg_client.describe_auto_scaling_instances()["AutoScalingInstances"]
            matching = [i for i in instances if i["AutoScalingGroupName"] == asg_name]
            if matching:
                instance_id = matching[0]["InstanceId"]

        return asg_name, instance_id

    return _make


@pytest.fixture
def hosted_zone(aws):
    """Creates a Route53 hosted zone for DNS-alias tests."""
    client = boto3.client("route53")
    response = client.create_hosted_zone(
        Name="example.com", CallerReference="test-caller-ref"
    )
    return response["HostedZone"]["Id"]
