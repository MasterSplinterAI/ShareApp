# EC2 Instance Recommendations for LiveKit Translation App

## Current Setup
- **Instance**: t3.small
- **Specs**: 2 vCPU, 2GB RAM
- **Cost**: ~$15/month (on-demand)

## Resource Requirements Per Session

Each concurrent translation session uses:
- **RAM**: ~150-200MB (AgentSession + VAD + audio buffers)
- **CPU**: ~0.2-0.3 vCPU (spikes during STT/TTS processing)
- **Network**: ~50-100 Kbps (audio streams)

Base system overhead:
- Backend Node.js: ~300MB RAM
- Nginx: ~50MB RAM
- System: ~500MB RAM
- **Total base**: ~850MB RAM

## Instance Recommendations

### Tier 1: Development / Low Traffic
**t3.small** (Current)
- **Specs**: 2 vCPU, 2GB RAM
- **Cost**: ~$15/month (on-demand), ~$10/month (reserved)
- **Capacity**: 3-5 concurrent sessions comfortably
- **Best for**: Testing, development, low traffic
- **Limitations**: May throttle under sustained load

### Tier 2: Production / Moderate Traffic ⭐ **RECOMMENDED**
**t3.medium**
- **Specs**: 2 vCPU, 4GB RAM
- **Cost**: ~$30/month (on-demand), ~$20/month (reserved)
- **Capacity**: 10-15 concurrent sessions comfortably
- **Best for**: Production deployment, moderate traffic
- **Benefits**: 
  - 2x RAM = 2x capacity
  - Better CPU credit balance
  - Room to grow
  - Only $15/month more than t3.small

### Tier 3: High Traffic / Multiple Rooms
**t3.large**
- **Specs**: 2 vCPU, 8GB RAM
- **Cost**: ~$60/month (on-demand), ~$40/month (reserved)
- **Capacity**: 20-30 concurrent sessions comfortably
- **Best for**: High traffic, multiple concurrent rooms
- **Benefits**: Plenty of headroom for scaling

### Tier 4: Enterprise / Dedicated Performance
**t3.xlarge**
- **Specs**: 4 vCPU, 16GB RAM
- **Cost**: ~$120/month (on-demand)
- **Capacity**: 40+ concurrent sessions
- **Best for**: Enterprise deployments, high availability
- **Benefits**: Dedicated CPU, no throttling

## Alternative: t3a Series (AMD-based)
Same specs as t3 series but ~10% cheaper:
- **t3a.medium**: ~$25/month (vs $30 for t3.medium)
- **t3a.large**: ~$50/month (vs $60 for t3.large)
- **Best for**: Cost optimization without performance loss

## Cost Optimization Strategies

### 1. Reserved Instances (1-year commitment)
- **Savings**: 30-40% vs on-demand
- **Example**: t3.medium: $20/month (vs $30 on-demand)
- **Best for**: Predictable workloads

### 2. Savings Plans
- **Savings**: 20-30% vs on-demand
- **Flexibility**: Can be used across different instance types
- **Best for**: Variable but predictable workloads

### 3. Spot Instances
- **Savings**: ~70% vs on-demand
- **Risk**: Can be interrupted with 2-minute notice
- **Best for**: Development/testing only
- **Not recommended**: Production (unreliable)

## Capacity Planning

### t3.small (2GB RAM)
- **Theoretical max**: 8-10 sessions
- **Comfortable**: 3-5 sessions
- **CPU throttling**: May occur with 4+ concurrent sessions
- **Recommendation**: Upgrade if expecting >5 concurrent sessions

### t3.medium (4GB RAM) ⭐
- **Theoretical max**: 18-20 sessions
- **Comfortable**: 10-15 sessions
- **CPU throttling**: Rare, only under extreme load
- **Recommendation**: Best value for production

### t3.large (8GB RAM)
- **Theoretical max**: 35-40 sessions
- **Comfortable**: 20-30 sessions
- **CPU throttling**: Very rare
- **Recommendation**: For high-traffic deployments

## Performance Considerations

### CPU Credits (t3 series)
- **Baseline**: Earns credits continuously
- **Burst**: Uses credits for CPU-intensive tasks (STT/TTS)
- **Throttling**: Occurs if credits exhausted
- **Impact**: Translation latency may increase

**Recommendation**: t3.medium has better credit balance for sustained load

### Memory Usage
- **VoiceAssistant/VAD**: ~100MB per session
- **Audio buffers**: ~50MB per session
- **Python overhead**: ~50MB per session
- **Total per session**: ~200MB

**Recommendation**: Leave 1GB free for system + overhead

## Migration Path

```
t3.small → t3.medium → t3.large
   ↓           ↓           ↓
<5 sessions  5-15 sessions  15+ sessions
```

**Upgrade triggers**:
- Consistently >80% RAM usage
- CPU throttling warnings
- High latency during peak usage
- Planning for growth

## Recommendation Summary

### For Your Current Use Case: **t3.medium** ⭐

**Why**:
1. Only $15/month more than t3.small
2. 2x RAM = 2x capacity
3. Better performance under load
4. Room to grow without immediate upgrade
5. Still cost-effective

**When to upgrade**:
- Consistently hitting 10+ concurrent sessions
- CPU throttling warnings in CloudWatch
- Planning for significant growth

**Cost comparison**:
- t3.small: $15/month (on-demand)
- t3.medium: $30/month (on-demand) or $20/month (reserved)
- **Difference**: $15/month = $180/year

**ROI**: Worth it for production reliability and capacity

## Monitoring Recommendations

Set up CloudWatch alarms for:
1. **CPU Credit Balance** < 100 (t3 series)
2. **Memory Utilization** > 80%
3. **Network In/Out** (to detect scaling needs)
4. **Status Check Failed** (instance health)

## Next Steps

1. **Test current capacity** on t3.small
2. **Monitor resource usage** for 1-2 weeks
3. **Upgrade to t3.medium** if:
   - Consistently >5 concurrent sessions
   - Seeing performance issues
   - Planning for growth
4. **Consider reserved instances** if staying on same size

## Quick Reference

| Instance | RAM | vCPU | Cost/Month | Sessions | Best For |
|----------|-----|------|------------|----------|----------|
| t3.small | 2GB | 2 | $15 | 3-5 | Dev/Test |
| t3.medium | 4GB | 2 | $30 | 10-15 | **Production** ⭐ |
| t3.large | 8GB | 2 | $60 | 20-30 | High Traffic |
| t3.xlarge | 16GB | 4 | $120 | 40+ | Enterprise |

