# Lalia operations monitor

Checks the public backend process and metadata of daily backup runs independently every five minutes. This does not test database health, RTC translation, cryptographic integrity, or restorability. Continue isolated restore drills and RTC canaries.

## Local verification and deployment

From the repository root:

```sh
node --test scripts/operations-monitor/monitor.test.mjs
python3 -m unittest discover -s scripts/operations-monitor -p 'test_*.py'
python3 scripts/operations-monitor/deploy.py
```

The last command renders the full configuration without AWS calls or mutations. Inspect its separate runtime/Scheduler policies, trusts, SNS policy, Lambda configuration, and three alarms. The owner approved these resources and `kennyrhule@proton.me`; use the reviewed configuration to install:

```sh
python3 scripts/operations-monitor/deploy.py --apply --profile jarmetals
```

The operator's existing authenticated profile performs provisioning; its credentials never enter the Lambda or source package. The script validates AWS account `690248313257` and uses explicit region `us-east-2`. It creates/updates only the named monitor resources. Reapplying updates the monitor configuration/code, policies, retention and schedule, without modifying application or backup resources. It skips an existing email subscription, including a pending one. A partially failed installation is safe to inspect and reapply; there is no automatic resource deletion.

Runtime is Node.js 24 with its included AWS SDK v3. No application dependencies are packaged. Lambda has no VPC subnets/security groups, no NAT gateway, a 30-second timeout, 128 MB memory, ARM64 architecture and reserved concurrency one. Logs expire after 14 days. HTTP has a six-second overall deadline and 4 KiB response limit; redirects are rejected entirely, certificates remain verified. S3 listing has a twelve-second total deadline; metric publication has a six-second deadline. Probes run concurrently.

The runtime role allows only `s3:ListBucket` with exact requested prefix `lalia/daily/` on the backup bucket, `cloudwatch:PutMetricData` for `Lalia/Operations`, and stream creation/writes within the precreated monitor log group. It cannot download dumps/uploads/manifests or retrieve secrets. Scheduler uses a separate role with only invocation permission on this Lambda. Its trust is scoped to the dedicated `lalia-operations` schedule group and AWS account. SNS accepts CloudWatch publication only from the three exact alarm ARNs and account. No new access keys are issued.

Backup completion requires exactly `manifest.json`, `database.dump`, and `uploads.tar.gz` in the same run directory, each nonempty. Select the newest valid manifest `LastModified` across all paginated listing results; a complete run remains valid for 26 hours inclusive. Incomplete/newer runs do not invalidate an existing fresh complete run. Future timestamps, extra/nested objects within a run, empty objects, stale manifests and missing components cannot qualify. This reads only listing metadata.

## Signals and response

All metrics use fixed dimension `Service=lalia-production`, namespace `Lalia/Operations`, and values zero/failure or one/success. Each alarm uses the minimum within a five-minute period, two breaching periods out of three, threshold below one, and missing data treated as breaching. ALARM and OK transitions publish to SNS. The heartbeat is published in the same batch as both check results; failed individual checks still publish the other result and heartbeat. Publication failure fails the invocation and leaves absent data for alarm evaluation.

- `ApiHealthy`: Check `https://lalia.cloud/api/health`, DNS/TLS and the existing backend process. Expected JSON includes `status=ok` and `service=livekit-backend`. Inspect service status through the established operational access path; do not put credentials, response bodies or customer data in tickets.
- `BackupFresh`: Inspect the monitor's numeric `backupAgeHours` and categorical status in `/aws/lambda/lalia-operations-monitor`. Inspect the existing backup service/timer and S3 metadata. Preserve existing artifacts; do not delete an incomplete run while diagnosing. Re-run the established backup procedure if appropriate, then perform a separate restore drill when needed.
- `MonitorHeartbeat`: Inspect Lambda invocation errors/throttling, the enabled Scheduler schedule/role, CloudWatch publication permissions and regional AWS status. The monitor deliberately cannot repair infrastructure or the application.

SNS notification messages include check identity, state, evaluation timestamps and this runbook link. Exact backup age is available in safe monitor logs. No response bodies, manifest contents, customer identifiers or credentials are logged. CloudWatch notifies on state changes; this does not provide escalating pages or repeated reminders. Monitoring is independent of EC2 but shares this AWS account/region's failure modes.

## Post-deployment acceptance

1. Read back Lambda configuration/concurrency, 14-day log retention, the schedule, all three alarms, SNS policy/subscription status and both IAM inline/trust policies. Invoke the monitor and check its three metrics with the fixed dimension. Wait for scheduled invocations as independent evidence of Scheduler permission.
2. Use IAM policy simulation for the runtime role: allow exact-prefix listing and namespace publication; deny another prefix/bucket, `s3:GetObject`, secret retrieval, unrelated log writes, log reads/deletes. Simulate Scheduler invocation against the exact function and an unrelated function. Resource-policy simulation has AWS limitations; inspect the SNS exact SourceArn/SourceAccount restrictions as well.
3. The recipient must click the SNS confirmation email. A confirmed subscription is not evidence of delivered alerts. Record actual receipt of a controlled ALARM email and its OK recovery email separately; keep delivery marked unverified until receipt is reported.
4. Use a temporary test alarm with a unique test metric/dimension and **no actions** to verify missing heartbeat without stopping the real monitor or backups. Copy the production 300-second, two-of-three, missing-breaching configuration. Initially omit data and wait for ALARM; publish good fixture values across separate periods and wait for OK. Remove the test alarm afterward; metrics age out naturally. Keep the SNS policy restricted to the three production alarm ARNs. After the email subscription is confirmed, coordinate a clearly labeled synthetic ALARM then OK state override on the existing heartbeat alarm using `SetAlarmState`; this tests notification routing without an outage or production metric injection. Inspect alarm history for successful SNS action execution and separately record actual recipient receipt. Automatic metric evaluation resumes after a state override.
5. Save sanitized resource IDs, policy checks, configuration, latest metrics, alarm history and email receipt status in launch evidence. Do not save raw application logs or any credentials. Existing backend health and daily backup timers must remain healthy.

## Rollback

Disable `lalia-operations-monitor` in schedule group `lalia-operations` and disable actions on its three alarms first. Preserve backup timers, backup bucket/objects, log writers and recovery records. After investigation remove only the dedicated schedule/group, alarms, Lambda, its two roles/inline policies, SNS topic/subscription and monitor log group if full removal is intended. Keep evidence before removing logs; no automated rollback deletes resources.

## Official references

- [Lambda Node.js runtimes and included SDK](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
- [Scheduler trust must use the schedule-group ARN](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html)
- [CloudWatch alarm notifications and SNS source restrictions](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
