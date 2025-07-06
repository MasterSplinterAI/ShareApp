#!/bin/bash

# Instructions to manually open ports in AWS security group
echo "===== AWS Security Group Update Required ====="
echo "Please open ports 80 and 443 in the AWS security group:"
echo "1. Login to AWS Console"
echo "2. Go to EC2 > Security Groups"
echo "3. Find the security group associated with instance 3.133.136.182"
echo "4. Edit inbound rules"
echo "5. Add rules for HTTP (port 80) and HTTPS (port 443) from anywhere (0.0.0.0/0)"
echo "==============================================" 