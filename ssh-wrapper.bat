@echo off
ssh -i "C:\Users\Administrator\Downloads\AxisAlgo.pem" -o "UserKnownHostsFile=/dev/null" -o "StrictHostKeyChecking=no" -p 22 %*