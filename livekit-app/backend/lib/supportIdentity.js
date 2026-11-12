const {supportBusinessId}=require('@rhule/ops-sdk');
const LEGACY_SUPPORT_TENANT='lalia';
const getSupportBusinessId=()=>supportBusinessId(process.env.OPS_HUB_BUSINESS_ID,LEGACY_SUPPORT_TENANT);
module.exports={LEGACY_SUPPORT_TENANT,getSupportBusinessId};
