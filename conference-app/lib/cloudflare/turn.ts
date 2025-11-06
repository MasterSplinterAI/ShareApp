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
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${this.turnTokenId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        }
      );

      if (!response.ok) {
        throw new Error(`Cloudflare API returned ${response.status}: ${await response.text()}`);
      }

      const data: CloudflareTURNResponse = await response.json();

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
    } catch (error) {
      console.error('⚠️ Failed to fetch Cloudflare TURN credentials:', error);
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
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
    const turnTokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;

    if (!apiToken || !turnTokenId) {
      throw new Error('Missing Cloudflare TURN credentials in environment variables');
    }

    turnInstance = new CloudflareTURN(apiToken, turnTokenId);
  }

  return turnInstance;
}
