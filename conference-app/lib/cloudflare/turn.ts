// Cloudflare TURN Credentials Helper for Next.js
// Handles TURN server credential generation using Cloudflare's API

interface ICEServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface CloudflareTURNResponse {
  iceServers: {
    urls: string[];
    username: string;
    credential: string;
  }[];
}

export class CloudflareTURN {
  private apiToken: string;
  private turnTokenId: string;
  private cache: ICEServer[] | null = null;
  private cacheExpiry: number | null = null;

  constructor(apiToken: string, turnTokenId: string) {
    this.apiToken = apiToken;
    this.turnTokenId = turnTokenId;
  }

  /**
   * Generate TURN credentials from Cloudflare API
   * @param ttl - Time to live in seconds (default: 86400 = 24 hours)
   * @returns Array of ICE server configurations
   */
  async generateCredentials(ttl: number = 86400): Promise<ICEServer[]> {
    // Check cache first
    const now = Date.now();
    if (this.cache && this.cacheExpiry && now < this.cacheExpiry) {
      console.log('✅ Using cached Cloudflare TURN credentials');
      return this.cache;
    }

    // Generate new credentials
    console.log('🔄 Generating new Cloudflare TURN credentials...');
    
    try {
      // Use Node.js https module (like the original app) instead of fetch
      const https = require('https');
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

      const data = await new Promise<CloudflareTURNResponse>((resolve, reject) => {
        const req = https.request(options, (res: any) => {
          let responseData = '';
          res.on('data', (chunk: Buffer) => { 
            responseData += chunk.toString(); 
          });
          res.on('end', () => {
            try {
              // Cloudflare returns 201 (Created) for successful credential generation
              if (res.statusCode !== 200 && res.statusCode !== 201) {
                reject(new Error(`Cloudflare API returned ${res.statusCode}: ${responseData}`));
                return;
              }
              
              const json = JSON.parse(responseData);
              if (json.iceServers && json.iceServers.length > 0) {
                resolve(json);
              } else {
                reject(new Error('Invalid response from Cloudflare API: no iceServers'));
              }
            } catch (e: any) {
              reject(new Error(`Failed to parse Cloudflare response: ${e.message}`));
            }
          });
        });

        req.on('error', (error: Error) => {
          reject(new Error(`Cloudflare API request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
      });

      // Extract and format ICE servers
      if (data.iceServers && data.iceServers.length > 0) {
        const iceServers: ICEServer[] = data.iceServers.map(server => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        }));

        // Cache credentials (expire 1 hour before actual expiry)
        this.cache = iceServers;
        this.cacheExpiry = now + ((ttl - 3600) * 1000); // Cache for ttl - 1 hour

        console.log('✅ Generated Cloudflare TURN credentials');
        return iceServers;
      } else {
        throw new Error('Invalid response from Cloudflare API: no iceServers');
      }
    } catch (error: any) {
      console.error('⚠️ Failed to fetch Cloudflare TURN credentials:', error.message);
      throw error;
    }
  }

  /**
   * Clear the credentials cache
   */
  clearCache(): void {
    this.cache = null;
    this.cacheExpiry = null;
  }
}

// Singleton instance for server-side use
let turnInstance: CloudflareTURN | null = null;

export function getTURNInstance(): CloudflareTURN {
  if (!turnInstance) {
    // Check both CLOUDFLARE_API_TOKEN (original) and CLOUDFLARE_TURN_API_TOKEN (new)
    // Trim whitespace to handle any encoding issues
    const apiToken = (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_TURN_API_TOKEN)?.trim();
    const turnTokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID?.trim();

    if (!apiToken || !turnTokenId) {
      console.error('Missing Cloudflare TURN credentials:');
      console.error('  CLOUDFLARE_API_TOKEN:', process.env.CLOUDFLARE_API_TOKEN ? 'SET' : 'NOT SET');
      console.error('  CLOUDFLARE_TURN_API_TOKEN:', process.env.CLOUDFLARE_TURN_API_TOKEN ? 'SET' : 'NOT SET');
      console.error('  CLOUDFLARE_TURN_TOKEN_ID:', process.env.CLOUDFLARE_TURN_TOKEN_ID ? 'SET' : 'NOT SET');
      throw new Error('Missing Cloudflare TURN credentials in environment variables');
    }

    console.log(`Creating CloudflareTURN instance with token ID: ${turnTokenId}, API token length: ${apiToken.length}`);
    turnInstance = new CloudflareTURN(apiToken, turnTokenId);
  }

  return turnInstance;
}
