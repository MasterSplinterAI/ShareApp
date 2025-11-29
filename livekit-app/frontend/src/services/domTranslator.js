/**
 * DOM Translator Service
 * Translates text content in the DOM while excluding elements marked with data-no-translate
 * 
 * This service scans the DOM for text nodes and translates them using a translation API.
 * Elements with data-no-translate attribute are excluded from translation.
 */

class DOMTranslator {
  constructor() {
    this.isActive = false;
    this.targetLanguage = 'en';
    this.translatedElements = new WeakMap();
    this.observer = null;
    this.excludedSelectors = [
      '[data-no-translate]',
      'script',
      'style',
      'noscript',
      'code',
      'pre',
      '[class*="transcription"]',
      '[id*="transcription"]'
    ];
  }

  /**
   * Initialize the translator with target language
   * @param {string} targetLanguage - ISO language code (e.g., 'es', 'fr', 'de')
   */
  async init(targetLanguage = 'en') {
    if (targetLanguage === 'en') {
      // No translation needed for English
      this.stop();
      return;
    }

    this.targetLanguage = targetLanguage;
    this.isActive = true;
    
    // Mark transcription box as excluded
    this.markTranscriptionBoxExcluded();
    
    // Start observing DOM changes
    this.startObserving();
    
    // Translate existing content
    await this.translatePage();
  }

  /**
   * Mark transcription box elements as excluded
   */
  markTranscriptionBoxExcluded() {
    // Find transcription display component and mark it
    const transcriptionSelectors = [
      '[class*="TranscriptionDisplay"]',
      '[class*="transcription"]',
      '[id*="transcription"]',
      '.fixed.bottom-20.right-2', // TranscriptionDisplay positioning classes
      '.fixed.bottom-20.right-4'
    ];

    transcriptionSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        el.setAttribute('data-no-translate', 'true');
        // Also mark all children
        el.querySelectorAll('*').forEach(child => {
          child.setAttribute('data-no-translate', 'true');
        });
      });
    });
  }

  /**
   * Check if an element should be excluded from translation
   * @param {Node} node - DOM node to check
   * @returns {boolean} - True if node should be excluded
   */
  shouldExcludeNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return true;
    }

    let element = node.parentElement;
    while (element && element !== document.body) {
      // Check for data-no-translate attribute
      if (element.hasAttribute('data-no-translate')) {
        return true;
      }

      // Check excluded selectors
      for (const selector of this.excludedSelectors) {
        if (element.matches(selector)) {
          return true;
        }
      }

      element = element.parentElement;
    }

    return false;
  }

  /**
   * Get API base URL (same logic as api.js)
   * @returns {string} - API base URL
   */
  getApiBaseUrl() {
    const isNgrok = window.location.hostname.includes('ngrok.app') || 
                     window.location.hostname.includes('ngrok-free.app') ||
                     window.location.hostname.includes('ngrok.io');
    const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const isHTTPS = window.location.protocol === 'https:';

    let API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

    if (isNgrok) {
      API_BASE_URL = '/api';
    } else if (isNetworkAccess && isHTTPS) {
      API_BASE_URL = '/api';
    } else if (isNetworkAccess) {
      API_BASE_URL = `http://${window.location.hostname}:3001/api`;
    } else {
      API_BASE_URL = '/api';
    }

    return API_BASE_URL;
  }

  /**
   * Translate text using translation API
   * @param {string} text - Text to translate
   * @returns {Promise<string>} - Translated text
   */
  async translateText(text) {
    if (!text || !text.trim()) {
      return text;
    }

    // Skip if already translated (check cache)
    const cacheKey = `${text}:${this.targetLanguage}`;
    const cached = sessionStorage.getItem(`translation_${cacheKey}`);
    if (cached) {
      return cached;
    }

    try {
      const apiBaseUrl = this.getApiBaseUrl();
      
      // Call backend translation endpoint
      const response = await fetch(`${apiBaseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text.trim(),
          targetLanguage: this.targetLanguage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Translation failed: ${response.statusText}`);
      }

      const data = await response.json();
      const translatedText = data.translatedText || text;

      // Cache the translation
      sessionStorage.setItem(`translation_${cacheKey}`, translatedText);

      return translatedText;
    } catch (error) {
      console.error('Translation error:', error);
      // Return original text on error
      return text;
    }
  }

  /**
   * Translate a text node
   * @param {Text} textNode - Text node to translate
   */
  async translateTextNode(textNode) {
    if (!this.isActive || this.shouldExcludeNode(textNode)) {
      return;
    }

    const originalText = textNode.textContent.trim();
    if (!originalText || originalText.length < 2) {
      return;
    }

    // Skip if already translated
    if (this.translatedElements.has(textNode)) {
      return;
    }

    // Translate the text
    const translatedText = await this.translateText(originalText);
    
    if (translatedText !== originalText) {
      // Store original text for restoration
      textNode.setAttribute('data-original-text', originalText);
      textNode.textContent = translatedText;
      this.translatedElements.set(textNode, originalText);
    }
  }

  /**
   * Translate all text nodes in the page
   */
  async translatePage() {
    if (!this.isActive) {
      return;
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!this.shouldExcludeNode(node)) {
        textNodes.push(node);
      }
    }

    // Translate in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < textNodes.length; i += batchSize) {
      const batch = textNodes.slice(i, i + batchSize);
      await Promise.all(batch.map(node => this.translateTextNode(node)));
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Start observing DOM changes for dynamic content
   */
  startObserving() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(async (mutations) => {
      if (!this.isActive) {
        return;
      }

      const textNodesToTranslate = [];

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              if (!this.shouldExcludeNode(node)) {
                textNodesToTranslate.push(node);
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is the transcription box and mark it
              if (node.matches && (
                node.matches('[class*="transcription"]') ||
                node.matches('[id*="transcription"]') ||
                node.querySelector('[class*="transcription"]')
              )) {
                node.setAttribute('data-no-translate', 'true');
                node.querySelectorAll('*').forEach(child => {
                  child.setAttribute('data-no-translate', 'true');
                });
              } else {
                // Find text nodes in the new element
                const walker = document.createTreeWalker(
                  node,
                  NodeFilter.SHOW_TEXT,
                  null
                );
                let textNode;
                while ((textNode = walker.nextNode())) {
                  if (!this.shouldExcludeNode(textNode)) {
                    textNodesToTranslate.push(textNode);
                  }
                }
              }
            }
          });
        } else if (mutation.type === 'characterData') {
          // Text content changed
          if (!this.shouldExcludeNode(mutation.target)) {
            textNodesToTranslate.push(mutation.target);
          }
        }
      });

      // Translate new text nodes
      if (textNodesToTranslate.length > 0) {
        await Promise.all(
          textNodesToTranslate.map(node => this.translateTextNode(node))
        );
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /**
   * Stop translation and restore original text
   */
  stop() {
    this.isActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Restore original text
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while ((node = walker.nextNode())) {
      const originalText = node.getAttribute('data-original-text');
      if (originalText) {
        node.textContent = originalText;
        node.removeAttribute('data-original-text');
      }
    }

    this.translatedElements = new WeakMap();
  }

  /**
   * Change target language
   * @param {string} newLanguage - New target language code
   */
  async changeLanguage(newLanguage) {
    if (newLanguage === this.targetLanguage) {
      return;
    }

    // Stop current translation
    this.stop();

    // Start with new language
    if (newLanguage !== 'en') {
      await this.init(newLanguage);
    }
  }
}

// Export singleton instance
export const domTranslator = new DOMTranslator();

