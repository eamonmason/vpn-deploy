#!/usr/bin/env python3
"""
Simple script to start up the VPN in a given region by
publishing a message to an SNS topic.
"""
import argparse
import json
import sys

import boto3

TAG_NAME = 'application-name'
TAG_VALUE = 'wireguard-vpn'

# Create the parser
parser = argparse.ArgumentParser(description='Publish message to SNS topic')

# Add the arguments
parser.add_argument('region', type=str, help='The region in which to enable the VPN')
parser.add_argument('whitelist_ip', type=str, help='The whitelist IP to allow access to the VPN')

args = parser.parse_args()

sns = boto3.client('sns', 'eu-west-1')

# Get list of all topics
topics = sns.list_topics()['Topics']

# Iterate over topics
for topic in topics:
    topic_arn = topic['TopicArn']
    # Get tags for each topic
    tags = sns.list_tags_for_resource(ResourceArn=topic_arn)['Tags']
    # Check if topic has desired tag name and value
    for tag in tags:
        if tag['Key'] == TAG_NAME and tag['Value'] == TAG_VALUE:
            # Post a message to the topic
            message = {"region": args.region, "whitelist_ip": args.whitelist_ip}
            print(f"VPN in {args.region} being switched on for {args.whitelist_ip}")
            sns.publish(TopicArn=topic_arn, Message=json.dumps(message))
            sys.exit(0)

print("Unable to publish message")
sys.exit(1)
