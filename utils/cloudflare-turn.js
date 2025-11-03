// Cloudflare TURN Credentials Helper
// Simple wrapper for Cloudflare TURN API credential generation

const https = require('https');

class CloudflareTURN {
  constructor(apiToken, turnTokenId) {
    this.apiToken = apiToken;
    this.turnTokenId = turnTokenId;
    this.cache = null;
    this.cacheExpiry = null;
  }

  /**
   * Generate TURN credentials from Cloudflare API
   * @param {number} ttl - Time to live in seconds (default: 86400 = 24 hours)
   * @returns {Promise<Array>} Array of ICE server configurations
   */
  async generateCredentials(ttl = 86400) {
    // Check cache first
    const now = Date.now();
    if (this.cache && this.cacheExpiry && now < this.cacheExpiry) {
      console.log('✅ Using cached Cloudflare TURN credentials');
      return this.cache;
    }

    // Generate new credentials
    console.log('🔄 Generating new Cloudflare TURN credentials...');
    
    try {
      const postData = JSON.stringify({ ttl });
      
      const options = {
        hostname: 'rtc.live.cloudflare.com',
        path: `/v1/turn/keys/${this.turnTokenId}/credentials/generate-ice-servers`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const response = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode !== 200 && res.statusCode !== 201) {
              reject(new Error(`Cloudflare API returned ${res.statusCode}: ${data}`));
              return;
            }
            
            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (e) {
              reject(new Error(`Failed to parse Cloudflare response: ${e.message}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(new Error(`Cloudflare API request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      });

      // Extract and format ICE servers
      if (response.iceServers && response.iceServers.length > 0) {
        const iceServers = response.iceServers.map(server => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential
        }));

        // Cache credentials (expire 1 hour before actual expiry)
        this.cache = iceServers;
        this.cacheExpiry = now + ((ttl - 3600) * 1000); // Cache for ttl - 1 hour

        console.log('✅ Generated Cloudflare TURN credentials');
        return iceServers;
      } else {
        throw new Error('Invalid response from Cloudflare API: no iceServers');
      }
    } catch (error) {
      console.error('⚠️ Failed to fetch Cloudflare TURN credentials:', error.message);
      throw error;
    }
  }

  /**
   * Clear the credentials cache
   */
  clearCache() {
    this.cache = null;
    this.cacheExpiry = null;
  }
}

module.exports = CloudflareTURN;

