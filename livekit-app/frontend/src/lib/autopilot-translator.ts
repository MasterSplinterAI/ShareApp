import axios from 'axios';

interface TranslationCache {
    [key: string]: string;
}

const BATCH_SEPARATOR = '---SEPARATOR---';
const CHUNK_SIZE = 100;
const MAX_PARALLEL_BATCHES = 2;

function isPoisonedBatchTranslation(sourceText: string, translatedText: string): boolean {
    if (!translatedText?.includes(BATCH_SEPARATOR)) return false;
    return !sourceText?.includes(BATCH_SEPARATOR);
}

function sanitizeTranslationCache(cache: TranslationCache): TranslationCache {
    const cleaned: TranslationCache = {};
    Object.entries(cache).forEach(([key, value]) => {
        const colon = key.indexOf(':');
        if (colon === -1) {
            cleaned[key] = value;
            return;
        }
        const source = key.slice(colon + 1);
        if (!isPoisonedBatchTranslation(source, value)) {
            cleaned[key] = value;
        }
    });
    return cleaned;
}

export interface AutopilotTranslatorConfig {
    apiKey?: string;
    apiEndpoint?: string;
    language?: string;
    enabledPages?: string[];
}

type TextNodeBinding = { node: Text; text: string; originalText: string };

interface TranslationQueueJob {
    pageId: string;
    priority: number;
    texts: string[];
    textToNodes: Map<string, TextNodeBinding[]>;
}

class AutopilotTranslator {
    private currentLanguage: string = 'en';
    private cache: TranslationCache = {};
    private observer: MutationObserver | null = null;
    private isTranslating: boolean = false;
    private pendingTranslations: Map<string, Promise<string>> = new Map();
    private enabledPages: string[] = [];
    private currentPageId: string = '';
    private apiEndpoint: string = '/api';
    private translateTimeout: ReturnType<typeof setTimeout> | null = null;
    private batchAbortController: AbortController | null = null;
    private translationQueue: TranslationQueueJob[] = [];
    private activeBatchWorkers = 0;

    /**
     * Get current language (for debugging)
     */
    public get currentLanguageValue(): string {
        return this.currentLanguage;
    }

    constructor(config?: AutopilotTranslatorConfig) {
        // Set API endpoint if provided
        if (config?.apiEndpoint) {
            this.apiEndpoint = config.apiEndpoint.replace(/\/$/, ''); // Remove trailing slash
        }
        
        // Set initial language from config or load from URL/localStorage
        if (config?.language) {
            this.currentLanguage = config.language;
            localStorage.setItem('app_language', config.language);
        } else {
            this.loadLanguage();
        }
        
        // Set enabled pages from config
        if (config?.enabledPages !== undefined) {
            this.enabledPages = config.enabledPages;
        }
        
        // Load cache from localStorage
        this.loadCache();
    }

    /**
     * Initialize autopilot translation
     */
    public init(language: string = 'en', enabledPages: string[] = []): void {
        this.currentLanguage = language;
        this.enabledPages = enabledPages;
        
        // Log initialization status
        if (enabledPages.length === 0) {
            console.log('🌐 Autopilot Translator: Enabled for ALL pages');
        } else {
            console.log('🌐 Autopilot Translator: Enabled for pages:', enabledPages);
        }
        
        // Check if current page is enabled
        if (!this.isPageEnabled()) {
            console.log('🌐 Autopilot Translator: Current page not enabled for translation');
            return;
        }

        if (language === 'en') {
            // No translation needed for English
            console.log('🌐 Autopilot Translator: English selected, translation disabled');
            return;
        }

        console.log(`🌐 Autopilot Translator: Initialized for language: ${language}`);
        
        // CRITICAL: Use a small delay to ensure DOM is fully rendered before storing/translating
        // This is especially important for new users joining, as LiveKit components may still be rendering
        setTimeout(() => {
            // CRITICAL: Before storing/translating, ensure page is in English
            // If page was already translated from a previous session, restore to English first
            // This ensures we always have English text stored, even if user joins with non-English language
            console.log('🔄 Ensuring page is in English before storing original text...');
            this.ensureEnglishState();
            
            // CRITICAL: Store original text AFTER ensuring English state
            // This ensures we can restore to English later
            console.log('📝 Storing original English text before translation...');
            const storedCount = this.storeOriginalText();
        
        // Start observing DOM changes
        this.startObserving();
        
        // Translate existing content
            // Only translate if we actually stored some text (DOM is ready)
            if (storedCount > 0 || document.querySelectorAll('[data-original-text]').length > 0) {
                this.translatePageInternal().catch(err => {
                    console.error('Error in initial translation:', err);
                });
            } else {
                console.log('⚠️ No text stored yet. DOM might not be ready. Will retry...');
                // Retry after another delay
                setTimeout(() => {
                    const retryStoredCount = this.storeOriginalText();
                    if (retryStoredCount > 0 || document.querySelectorAll('[data-original-text]').length > 0) {
                        this.translatePageInternal().catch(err => {
                            console.error('Error in retry translation:', err);
                        });
                    } else {
                        console.warn('⚠️ Still no text found after retry. Translation will happen when DOM is ready via observer.');
                    }
                }, 500);
            }
        }, 300); // Delay to ensure DOM is fully rendered (especially LiveKit components)
    }
    
    /**
     * Ensure page is in English state before storing/translating
     * If page was already translated, restore to English first
     */
    private ensureEnglishState(): void {
        // Check if page has any data-original-text attributes (indicates previous translation)
        const hasTranslatedElements = document.querySelectorAll('[data-original-text]').length > 0;
        
        if (hasTranslatedElements) {
            console.log('🔄 Page appears to be translated. Restoring to English first...');
            // Restore to English using existing data-original-text attributes
            this.restoreOriginalText();
            console.log('✅ Page restored to English state');
        } else {
            console.log('✅ Page is already in English state (no previous translations found)');
        }
    }
    
    /**
     * Store original English text in data-original-text attributes
     * This should be called AFTER ensuring English state
     * Returns the number of elements that had text stored
     */
    private storeOriginalText(): number {
        console.log('📝 Starting to store original English text...');
        
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    
                    // Skip script, style, etc.
                    const tagName = parent.tagName.toLowerCase();
                    if (['script', 'style', 'noscript', 'meta', 'title'].includes(tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip if parent has data-no-translate
                    if (parent.hasAttribute('data-no-translate') || parent.closest('[data-no-translate]')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // Meeting controls are translated via React labels — avoid batch DOM translation here.
                    if (parent.closest('.meeting-control-strip')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip if already has data-original-text (already stored)
                    // BUT: If it exists, verify it's actually English (not a translation)
                    if (parent.hasAttribute('data-original-text')) {
                        // Keep existing original text - don't overwrite
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        let storedCount = 0;
        let skippedCount = 0;
        let node;
        while (node = walker.nextNode()) {
            const textNode = node as Text;
            const text = textNode.textContent?.trim() || '';
            
            if (text.length < 2) continue; // Skip very short text
            
            const parent = textNode.parentElement;
            if (parent) {
                // Check if already stored
                if (parent.hasAttribute('data-original-text')) {
                    skippedCount++;
                    continue;
                }
                
                // Store original text - this is the English text before translation
                // CRITICAL: Store the CURRENT text as original (assuming page loads in English)
                parent.setAttribute('data-original-text', text);
                storedCount++;
            }
        }
        
        console.log(`📝 Stored original text for ${storedCount} elements (${skippedCount} already had original text)`);
        
        // If we stored very few elements, warn the user
        if (storedCount < 5 && skippedCount === 0) {
            console.warn('⚠️ Very few elements stored. Page might not be fully rendered yet, or content might already be translated.');
        }
        
        return storedCount + skippedCount; // Return total count of elements with stored text
    }

    /**
     * Check if current page is enabled for translation
     */
    private isPageEnabled(): boolean {
        const currentPath = window.location.pathname;
        // Live meetings: React owns the DOM; batch DOM translation causes removeChild crashes.
        if (
            currentPath.startsWith('/room/')
            || currentPath.startsWith('/join/')
        ) {
            return false;
        }

        // DOM fallback only for authenticated workspace UI (see domTranslationSync.js).
        if (!currentPath.startsWith('/v2/app')) {
            return false;
        }

        // Empty array means all pages are enabled (within checks above).
        if (this.enabledPages.length === 0) {
            return true;
        }

        const routeName = currentPath.replace(/^\//, '').replace(/\/$/, '') || 'dashboard';
        
        return this.enabledPages.some(page => {
            if (page === routeName) return true;
            if (currentPath.includes(page)) return true;
            return false;
        });
    }

    /**
     * Change language and retranslate
     */
    public async setLanguage(language: string): Promise<void> {
        if (this.currentLanguage === language) {
            console.log(`🔄 Language already set to ${language}, skipping`);
            return;
        }
        
        console.log(`🔄 setLanguage called: ${this.currentLanguage} → ${language}`);
        
        // Cancel any ongoing translations
        this.cancelOngoingTranslations();
        
        this.currentLanguage = language;
        localStorage.setItem('app_language', language);
        
        if (language === 'en') {
            // For English, restore original text from data attributes
            // We store original text before translating, so restore it now
            console.log('🔄 setLanguage("en") called - starting restoration...');
            
            // Stop observing first to prevent new translations during restoration
            if (this.observer) {
                console.log('🛑 Stopping observer...');
                this.observer.disconnect();
                this.observer = null;
            }
            
            // Restore original text synchronously
            console.log('📝 Calling restoreOriginalText()...');
            this.restoreOriginalText();
            console.log('✅ restoreOriginalText() completed');
            
            // Update URL without reload - remove lng parameter for English
            const url = new URL(window.location.href);
            url.searchParams.delete('lng');
            // Use replaceState to avoid triggering navigation
            window.history.replaceState({}, '', url);
            
            console.log('✅ English restoration complete');
            // Return resolved promise immediately since restoration is synchronous
            return Promise.resolve();
        }

        // When switching between languages, restore original text first
        // This ensures we're always translating from the original English text
        // Always restore before retranslating to ensure clean state
        this.restoreOriginalText();

        // Clear cache for new language (but keep data-original-text attributes)
        this.cache = {};
        this.loadCache();
        
        // Retranslate page (will use data-original-text attributes)
        await this.translatePageInternal();
    }
    
    private abortInFlightBatches(): void {
        if (this.batchAbortController) {
            this.batchAbortController.abort();
            this.batchAbortController = null;
        }
    }

    /** Visible page wins: abort in-flight work and push other jobs to the back. */
    private prioritizePage(pageId: string): void {
        const pageChanged = pageId !== this.currentPageId;
        this.currentPageId = pageId;

        if (pageChanged) {
            this.abortInFlightBatches();
            this.batchAbortController = new AbortController();
            this.translationQueue.forEach((job) => {
                if (job.pageId !== pageId && job.priority === 0) {
                    job.priority = 1;
                }
            });
        } else if (!this.batchAbortController) {
            this.batchAbortController = new AbortController();
        }
    }

    private mergeQueueJob(
        pageId: string,
        priority: number,
        texts: string[],
        textToNodes: Map<string, TextNodeBinding[]>,
    ): void {
        const existing = this.translationQueue.find(
            (job) => job.pageId === pageId && job.priority === priority,
        );

        if (existing) {
            const merged = new Set(existing.texts);
            texts.forEach((text) => merged.add(text));
            existing.texts = Array.from(merged);
            texts.forEach((text) => {
                const nodes = textToNodes.get(text);
                if (nodes) {
                    existing.textToNodes.set(text, nodes);
                }
            });
            return;
        }

        this.translationQueue.push({ pageId, priority, texts: [...texts], textToNodes });
    }

    private enqueuePageTranslation(
        pageId: string,
        texts: string[],
        textToNodes: Map<string, TextNodeBinding[]>,
    ): void {
        if (texts.length === 0) return;

        this.prioritizePage(pageId);
        this.mergeQueueJob(pageId, 0, texts, textToNodes);
        this.sortTranslationQueue();
        this.drainTranslationQueue();
    }

    private sortTranslationQueue(): void {
        this.translationQueue.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.pageId === this.currentPageId && b.pageId !== this.currentPageId) return -1;
            if (b.pageId === this.currentPageId && a.pageId !== this.currentPageId) return 1;
            return 0;
        });
    }

    private pickNextQueueJob(): TranslationQueueJob | null {
        this.translationQueue.forEach((job) => {
            if (job.priority === 0 && job.pageId !== this.currentPageId) {
                job.priority = 1;
            }
        });
        this.sortTranslationQueue();

        const visibleIdx = this.translationQueue.findIndex(
            (job) => job.priority === 0 && job.pageId === this.currentPageId,
        );
        if (visibleIdx !== -1) {
            return this.translationQueue.splice(visibleIdx, 1)[0] ?? null;
        }

        const visiblePending = this.translationQueue.some(
            (job) => job.priority === 0 && job.pageId === this.currentPageId,
        );
        if (visiblePending) return null;

        const bgIdx = this.translationQueue.findIndex((job) => job.priority === 1);
        if (bgIdx === -1) return null;

        return this.translationQueue.splice(bgIdx, 1)[0] ?? null;
    }

    private drainTranslationQueue(): void {
        while (
            this.activeBatchWorkers < MAX_PARALLEL_BATCHES
            && this.translationQueue.length > 0
        ) {
            const job = this.pickNextQueueJob();
            if (!job || job.texts.length === 0) break;

            this.activeBatchWorkers += 1;
            this.runQueueJob(job).finally(() => {
                this.activeBatchWorkers -= 1;
                this.updateTranslatingFlag();
                this.drainTranslationQueue();
            });
        }
    }

    private async runQueueJob(job: TranslationQueueJob): Promise<void> {
        const isVisiblePage = job.pageId === this.currentPageId && job.priority === 0;
        const signal = isVisiblePage ? this.batchAbortController?.signal : undefined;

        try {
            const translations = await this.translateBatch(job.texts, signal);
            const applyToDom = job.pageId === this.currentPageId && job.priority === 0;

            translations.forEach((translation, i) => {
                if (i >= job.texts.length || !translation) return;

                const originalText = job.texts[i];
                if (
                    translation === originalText
                    || isPoisonedBatchTranslation(originalText, translation)
                ) {
                    return;
                }

                const cacheKey = `${this.currentLanguage}:${originalText}`;
                this.cache[cacheKey] = translation;

                if (!applyToDom) return;

                const nodes = job.textToNodes.get(originalText);
                nodes?.forEach(({ node, originalText: orig }) => {
                    const parent = node.parentElement;
                    if (parent) {
                        const existingOriginal = parent.getAttribute('data-original-text');
                        if (!existingOriginal || existingOriginal !== orig) {
                            parent.setAttribute('data-original-text', orig);
                        }
                    }
                    node.textContent = translation;
                });
            });

            this.saveCache();
        } catch (error: any) {
            if (axios.isCancel?.(error) || error?.code === 'ERR_CANCELED') {
                if (job.pageId === this.currentPageId && job.priority === 0) {
                    this.mergeQueueJob(job.pageId, 0, job.texts, job.textToNodes);
                } else {
                    this.mergeQueueJob(job.pageId, 1, job.texts, job.textToNodes);
                }
                this.sortTranslationQueue();
                return;
            }
            console.error('Translation queue job failed:', error);
        }
    }

    private hasVisibleTranslationWork(): boolean {
        return this.translationQueue.some(
            (job) => job.priority === 0 && job.pageId === this.currentPageId,
        );
    }

    private updateTranslatingFlag(): void {
        if (!this.hasVisibleTranslationWork() && this.activeBatchWorkers === 0) {
            this.isTranslating = false;
        }
    }

    private applyCachedTranslations(
        originalTexts: string[],
        textToNodes: Map<string, TextNodeBinding[]>,
    ): string[] {
        const toTranslate: string[] = [];

        originalTexts.forEach((originalText) => {
            const cacheKey = `${this.currentLanguage}:${originalText}`;
            if (this.cache[cacheKey]) {
                const nodes = textToNodes.get(originalText);
                nodes?.forEach(({ node, originalText: orig }) => {
                    const parent = node.parentElement;
                    if (parent && !parent.hasAttribute('data-original-text')) {
                        parent.setAttribute('data-original-text', orig);
                    }
                    node.textContent = this.cache[cacheKey];
                });
            } else {
                toTranslate.push(originalText);
            }
        });

        return toTranslate;
    }
    
    /**
     * Cancel visible-page work and clear queue priority for navigation/language changes.
     */
    private cancelOngoingTranslations(): void {
        this.abortInFlightBatches();
        this.translationQueue = this.translationQueue.filter((job) => job.priority > 0);
        this.currentPageId = '';
        this.isTranslating = false;
    }

    /**
     * Public method to manually trigger translation
     */
    public async translatePage(): Promise<void> {
        await this.translatePageInternal();
    }

    /**
     * Translate entire page (internal) - cache first, then priority queue for API batches.
     */
    private async translatePageInternal(): Promise<void> {
        if (!this.isPageEnabled()) return;
        
        if (this.currentLanguage === 'en' || !this.observer) {
            console.log('⏸️ Skipping translation: language is English or observer is destroyed');
            return;
        }
        
        const pageId = window.location.pathname + window.location.search;
        
        this.prioritizePage(pageId);
        this.isTranslating = true;

        const textNodes = this.extractTextNodes(document.body);
        const textsToTranslate = this.filterTranslatableTexts(textNodes);
        
        if (textsToTranslate.length === 0) {
            console.log('⚠️ No text nodes found to translate. DOM might not be ready yet.');
            this.isTranslating = false;
            setTimeout(() => {
                if (this.currentLanguage !== 'en') {
                    console.log('🔄 Retrying translation after delay...');
                    this.translatePageInternal().catch((err) => {
                        console.error('Error in retry translation:', err);
                    });
                }
            }, 500);
            return;
        }
        
        console.log(`📝 Found ${textsToTranslate.length} text nodes to translate`);

        const textToNodes = new Map<string, TextNodeBinding[]>();
        textNodes.forEach(({ node, text }) => {
            if (!this.shouldTranslate(text)) return;

            const parent = node.parentElement;
            const originalText = parent?.getAttribute('data-original-text') || text;

            if (!textToNodes.has(originalText)) {
                textToNodes.set(originalText, []);
            }
            textToNodes.get(originalText)!.push({ node, text, originalText });
        });

        const originalTexts = Array.from(textToNodes.keys());
        const toTranslate = this.applyCachedTranslations(originalTexts, textToNodes);

        if (toTranslate.length === 0) {
            this.isTranslating = false;
            return;
        }

        this.enqueuePageTranslation(pageId, toTranslate, textToNodes);
    }

    /**
     * Restore original English text from data attributes
     * Improved: Always restore from data-original-text if available, simpler and more reliable
     */
    private restoreOriginalText(): void {
        console.log('🔄 Restoring original English text...');
        
        // Collect all elements with data-original-text
        const elementsWithOriginal = new Map<Element, string>();
        document.querySelectorAll('[data-original-text]').forEach((element) => {
            const original = element.getAttribute('data-original-text');
            if (original && original.trim().length > 0) {
                elementsWithOriginal.set(element, original.trim());
            }
        });
        
        console.log(`📝 Found ${elementsWithOriginal.size} elements with original text stored`);
        
        if (elementsWithOriginal.size === 0) {
            console.warn('⚠️ No elements with data-original-text found. Page may not have been translated yet, or original text was not stored.');
            console.warn('💡 This can happen if you joined with a non-English language already selected.');
            return;
        }
        
        let restoredCount = 0;
        
        // Strategy 1: Direct restoration for simple elements (only text, no child elements)
        elementsWithOriginal.forEach((originalText, element) => {
            const currentText = element.textContent?.trim() || '';
            
            // Skip if already matches original
            if (currentText === originalText) {
                return;
            }
            
            const childNodes = Array.from(element.childNodes);
            const textNodes = childNodes.filter(n => n.nodeType === Node.TEXT_NODE) as Text[];
            const elementNodes = childNodes.filter(n => n.nodeType === Node.ELEMENT_NODE);
            
            // Simple case: only text nodes, no child elements
            if (elementNodes.length === 0 && textNodes.length > 0) {
                element.textContent = originalText;
                restoredCount++;
                console.log(`  ↻ Restored element: "${currentText.substring(0, 50)}..." → "${originalText.substring(0, 50)}..."`);
                return;
            }
            
            // Complex case: has child elements, restore main text node
            if (textNodes.length > 0) {
                // Find the main text node (first non-empty one that doesn't match original)
                const mainTextNode = textNodes.find(tn => {
                    const text = tn.textContent?.trim() || '';
                    return text.length > 0 && text !== originalText;
                });
                
                if (mainTextNode) {
                    const beforeText = mainTextNode.textContent?.trim() || '';
                    mainTextNode.textContent = originalText;
                    restoredCount++;
                    console.log(`  ↻ Restored text node: "${beforeText.substring(0, 50)}..." → "${originalText.substring(0, 50)}..."`);
                }
            }
        });
        
        // Strategy 2: Walk through all text nodes and restore using parent's data-original-text
        // This catches any text nodes we might have missed in Strategy 1
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    
                    // Skip script, style, etc.
                    const tagName = parent.tagName.toLowerCase();
                    if (['script', 'style', 'noscript', 'meta', 'title'].includes(tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip if parent has data-no-translate
                    if (parent.hasAttribute('data-no-translate') || parent.closest('[data-no-translate]')) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // Meeting controls are translated via React labels — avoid batch DOM translation here.
                    if (parent.closest('.meeting-control-strip')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        
        let node;
        while (node = walker.nextNode()) {
            const textNode = node as Text;
            const currentText = textNode.textContent?.trim() || '';
            
            if (currentText.length === 0) continue;
            
            // Check if parent or ancestor has data-original-text
            const parent = textNode.parentElement;
            if (parent) {
                let originalElement = parent.hasAttribute('data-original-text') ? parent : null;
                
                if (!originalElement) {
                    originalElement = parent.closest('[data-original-text]');
                }
                
                if (originalElement) {
                    const originalText = originalElement.getAttribute('data-original-text');
                    if (originalText && originalText.trim() !== currentText) {
                        // Only restore if current text doesn't match original
                        // This prevents unnecessary DOM updates
                        textNode.textContent = originalText.trim();
                        restoredCount++;
                    }
                }
            }
        }
        
        console.log(`✅ Restored ${restoredCount} text elements to original English`);
        
        // Keep data-original-text attributes for future language switches
        // They'll be useful if user switches languages again
    }

    /**
     * Extract all text nodes from element
     */
    private extractTextNodes(element: Element): Array<{ node: Text; text: string }> {
        const textNodes: Array<{ node: Text; text: string }> = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // Skip if parent has data-no-translate or notranslate class
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    
                    if (
                        parent.hasAttribute('data-no-translate') ||
                        parent.hasAttribute('data-i18n-skip') ||
                        parent.classList.contains('notranslate') ||
                        parent.closest('[data-no-translate]') ||
                        parent.closest('[data-i18n-skip]') ||
                        parent.closest('.notranslate') ||
                        parent.closest('.meeting-room-root')
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Skip script, style, etc.
                    const tagName = parent.tagName.toLowerCase();
                    if (['script', 'style', 'noscript', 'meta', 'title'].includes(tagName)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    
                    // Include option elements (for dropdowns) and all other text nodes
                    // Note: option text nodes are children of option elements, so they'll be included
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent?.trim() || '';
            if (text.length > 0) {
                const textNode = node as Text;
                const parent = textNode.parentElement;
                
                // CRITICAL: Store original text BEFORE any translation happens
                // This ensures we always have the original English text stored
                // Check if parent already has data-original-text - if so, use that (it's the true original)
                // Otherwise, store current text as original (assuming it's English on first load)
                if (parent) {
                    const existingOriginal = parent.getAttribute('data-original-text');
                    if (!existingOriginal) {
                        // No original stored yet - store current text as original
                        // This assumes page loads in English first
                    parent.setAttribute('data-original-text', text);
                    }
                    // If existingOriginal exists, keep it - it's the true original English text
                }
                
                textNodes.push({ node: textNode, text });
            }
        }

        return textNodes;
    }

    /**
     * Filter texts that should be translated
     */
    private filterTranslatableTexts(
        textNodes: Array<{ node: Text; text: string }>
    ): string[] {
        const texts: string[] = [];
        const seen = new Set<string>();

        textNodes.forEach(({ text }) => {
            // Skip if too short or too long
            if (text.length < 2 || text.length > 500) return;
            
            // Skip if looks like URL, email, or number
            if (/^(https?:\/\/|mailto:|[\d.,$%]+)$/i.test(text)) return;
            
            // Skip if already seen (avoid duplicates)
            const normalized = text.toLowerCase().trim();
            if (seen.has(normalized)) return;
            seen.add(normalized);

            texts.push(text);
        });

        return texts;
    }

    /**
     * Check if text should be translated
     */
    private shouldTranslate(text: string): boolean {
        if (text.length < 2 || text.length > 500) return false;
        if (/^(https?:\/\/|mailto:|[\d.,$%]+)$/i.test(text)) return false;
        return true;
    }

    /**
     * Translate batch of texts — cache first, then API with optional cancel signal.
     * Large batches run up to two chunk requests in parallel for the visible page.
     */
    private async translateBatch(texts: string[], signal?: AbortSignal): Promise<string[]> {
        if (signal?.aborted) {
            const err = new Error('Translation batch aborted');
            (err as any).code = 'ERR_CANCELED';
            throw err;
        }

        const cached: string[] = [];
        const toTranslate: string[] = [];
        const indices: number[] = [];

        texts.forEach((text, index) => {
            const cacheKey = `${this.currentLanguage}:${text}`;
            if (this.cache[cacheKey] && !isPoisonedBatchTranslation(text, this.cache[cacheKey])) {
                cached[index] = this.cache[cacheKey];
            } else {
                toTranslate.push(text);
                indices.push(index);
            }
        });

        if (toTranslate.length === 0) {
            return cached;
        }

        const requestConfig = signal ? { signal } : undefined;

        const applyApiResults = (
            chunkTexts: string[],
            chunkIndices: number[],
            translations: string[],
        ) => {
            translations.forEach((translation, i) => {
                if (i >= chunkTexts.length || i >= chunkIndices.length) return;

                const originalIndex = chunkIndices[i];
                const originalText = chunkTexts[i];

                if (
                    translation
                    && typeof translation === 'string'
                    && translation.trim()
                    && !isPoisonedBatchTranslation(originalText, translation)
                ) {
                    cached[originalIndex] = translation;
                    this.cache[`${this.currentLanguage}:${originalText}`] = translation;
                } else {
                    cached[originalIndex] = originalText;
                }
            });
        };

        const postBatch = async (batchTexts: string[]) => {
            const response = await axios.post(
                `${this.apiEndpoint}/translate/batch`,
                {
                    texts: batchTexts,
                    target_language: this.currentLanguage,
                    source_language: 'en',
                },
                requestConfig,
            );

            let translations = response.data?.translations;
            if (!Array.isArray(translations)) {
                console.warn('Translations response is not an array:', response.data);
                translations = [];
            }
            return translations as string[];
        };

        if (toTranslate.length <= CHUNK_SIZE) {
            try {
                const translations = await postBatch(toTranslate);
                applyApiResults(toTranslate, indices, translations);
            } catch (error: any) {
                if (axios.isCancel?.(error) || error?.code === 'ERR_CANCELED') {
                    throw error;
                }
                console.error('Batch translation failed:', error);
                indices.forEach((index, i) => {
                    if (cached[index] === undefined) {
                        cached[index] = toTranslate[i];
                    }
                });
            }
        } else {
            const chunks: Array<{ texts: string[]; indices: number[] }> = [];
            for (let i = 0; i < toTranslate.length; i += CHUNK_SIZE) {
                chunks.push({
                    texts: toTranslate.slice(i, i + CHUNK_SIZE),
                    indices: indices.slice(i, i + CHUNK_SIZE),
                });
            }

            const PARALLEL_CHUNKS = 2;
            for (let i = 0; i < chunks.length; i += PARALLEL_CHUNKS) {
                if (signal?.aborted) {
                    const err = new Error('Translation batch aborted');
                    (err as any).code = 'ERR_CANCELED';
                    throw err;
                }

                const slice = chunks.slice(i, i + PARALLEL_CHUNKS);
                try {
                    const results = await Promise.all(
                        slice.map(async (chunk) => {
                            const translations = await postBatch(chunk.texts);
                            return { chunk, translations };
                        }),
                    );
                    results.forEach(({ chunk, translations }) => {
                        applyApiResults(chunk.texts, chunk.indices, translations);
                    });
                } catch (error: any) {
                    if (axios.isCancel?.(error) || error?.code === 'ERR_CANCELED') {
                        throw error;
                    }
                    console.error('Chunk translation failed:', error);
                    slice.forEach((chunk) => {
                        chunk.indices.forEach((index, j) => {
                            if (cached[index] === undefined) {
                                cached[index] = chunk.texts[j];
                            }
                        });
                    });
                }
            }
        }

        indices.forEach((index, i) => {
            if (cached[index] === undefined) {
                cached[index] = toTranslate[i];
            }
        });

        this.saveCache();
        return cached;
    }

    /**
     * Start observing DOM changes
     */
    private startObserving(): void {
        if (this.observer) {
            this.observer.disconnect();
        }
        
        // Also listen for select element focus/click events to translate dropdowns when opened
        // This ensures options are translated even if they were added after initial scan
        const handleSelectInteraction = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target && target.tagName.toLowerCase() === 'select') {
                // Small delay to ensure options are rendered and visible
                setTimeout(() => {
                    if (this.isPageEnabled() && !this.isTranslating && this.currentLanguage !== 'en') {
                        // Trigger translation - cache will prevent redundant API calls
                        this.translatePageInternal();
                    }
                }, 200);
            }
        };
        
        // Remove old listeners if they exist
        document.removeEventListener('focus', handleSelectInteraction, true);
        document.removeEventListener('click', handleSelectInteraction, true);
        // Add new listeners with capture to catch all select elements
        document.addEventListener('focus', handleSelectInteraction, true);
        document.addEventListener('click', handleSelectInteraction, true);

        this.observer = new MutationObserver((mutations) => {
            // CRITICAL: Don't translate if language is English or observer was destroyed
            if (this.currentLanguage === 'en' || !this.observer) {
                return;
            }
            
            // Debounce translations to avoid excessive API calls
            // Only translate if there are actual text changes
            const hasTextChanges = mutations.some(mutation => {
                // Check for childList changes (v-html, dynamic content, dropdowns)
                if (mutation.type === 'childList') {
                    // Check if any added nodes contain text or are elements that might contain text
                    const hasTextNodes = Array.from(mutation.addedNodes).some(node => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
                            return true;
                        }
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as Element;
                            const tagName = element.tagName.toLowerCase();
                            
                            // Specifically watch for option elements (dropdowns)
                            if (tagName === 'option') {
                                return true;
                            }
                            
                            // Watch for select elements (they contain options)
                            if (tagName === 'select') {
                                return true;
                            }
                            
                            // Watch for teleported dropdown divs (SearchableSelect components)
                            if (element.hasAttribute && element.hasAttribute('data-dropdown-id')) {
                                return true;
                            }
                            
                            // Check if it's a documentation-content div or contains text
                            if (element.classList.contains('documentation-content') || 
                                element.querySelector('.documentation-content') ||
                                element.querySelector('select') || // Contains a select dropdown
                                element.querySelector('[data-dropdown-id]') || // Contains a teleported dropdown
                                element.textContent?.trim()) {
                                return true;
                            }
                        }
                        return false;
                    });
                    if (hasTextNodes) return true;
                }
                // Check for characterData changes (text node updates)
                if (mutation.type === 'characterData' && mutation.target.textContent?.trim()) {
                    return true;
                }
                return false;
            });

            if (!hasTextChanges) return;

            // Check if this is a dropdown being opened (faster translation needed)
            const isDropdown = mutations.some(mutation => {
                if (mutation.type === 'childList') {
                    return Array.from(mutation.addedNodes).some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node as Element;
                            return element.hasAttribute && element.hasAttribute('data-dropdown-id');
                        }
                        return false;
                    });
                }
                return false;
            });
            
            const debounceTime = isDropdown ? 150 : 500; // Faster for dropdowns, normal for other content
            
            // CRITICAL: Clear any existing timeout before setting a new one
            if (this.translateTimeout) {
                clearTimeout(this.translateTimeout);
            }
            
            this.translateTimeout = setTimeout(() => {
                // Double-check language and observer before translating
                if (this.currentLanguage === 'en' || !this.observer) {
                    return;
                }
                if (this.isPageEnabled() && !this.isTranslating) {
                    // Run in background, don't await
                    // Reduced debounce for faster response to dynamic content
                    this.translatePageInternal();
                }
            }, debounceTime);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: false, // Don't watch attributes to reduce noise
        });
    }

    /**
     * Load language from URL or localStorage
     */
    private loadLanguage(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const lngParam = urlParams.get('lng');
        
        // Accept any language code from URL parameter
        if (lngParam) {
            this.currentLanguage = lngParam;
        } else {
            this.currentLanguage = localStorage.getItem('app_language') || 'en';
        }
    }

    /**
     * Load cache from localStorage
     */
    private loadCache(): void {
        try {
            const cached = localStorage.getItem(`translation_cache_v2_${this.currentLanguage}`);
            if (cached) {
                this.cache = sanitizeTranslationCache(JSON.parse(cached));
            }
        } catch (error) {
            console.error('Failed to load translation cache:', error);
        }
    }

    /**
     * Save cache to localStorage
     */
    private saveCache(): void {
        try {
            // Limit cache size (keep last 1000 entries)
            const entries = Object.entries(this.cache);
            if (entries.length > 1000) {
                const recent = entries.slice(-1000);
                this.cache = Object.fromEntries(recent);
            }
            
            localStorage.setItem(
                `translation_cache_v2_${this.currentLanguage}`,
                JSON.stringify(this.cache)
            );
        } catch (error) {
            console.error('Failed to save translation cache:', error);
        }
    }

    /**
     * Get current language
     */
    public getCurrentLanguage(): string {
        return this.currentLanguage;
    }

    /**
     * Cleanup
     */
    public destroy(): void {
        console.log('🧹 Destroying translator instance...');
        
        // Clear any pending translation timeouts
        if (this.translateTimeout) {
            console.log('🛑 Clearing pending translation timeout...');
            clearTimeout(this.translateTimeout);
            this.translateTimeout = null;
        }
        
        // Disconnect observer
        if (this.observer) {
            console.log('🛑 Disconnecting observer...');
            this.observer.disconnect();
            this.observer = null;
        }
        
        // Cancel any ongoing translations
        this.isTranslating = false;
        this.currentPageId = '';
        this.translationQueue = [];
        this.abortInFlightBatches();
        
        // Clear pending translations
        this.pendingTranslations.clear();
        
        // Set language to English to prevent any further translations
        this.currentLanguage = 'en';
        
        console.log('✅ Translator destroyed');
    }
}

// Import and re-export language utilities and selector
import { 
    SUPPORTED_LANGUAGES,
    getLanguage,
    getLanguageName,
    getNativeLanguageName,
    isLanguageSupported,
    getAllLanguageCodes,
    type Language
} from './languages';

import {
    LanguageSelector,
    createLanguageSelector,
    type LanguageSelectorOptions
} from './language-selector';

// Export class and singleton instance
export { AutopilotTranslator };
export const autopilotTranslator = new AutopilotTranslator();

// Re-export language utilities and selector
export { 
    SUPPORTED_LANGUAGES,
    getLanguage,
    getLanguageName,
    getNativeLanguageName,
    isLanguageSupported,
    getAllLanguageCodes,
    LanguageSelector,
    createLanguageSelector,
    type Language,
    type LanguageSelectorOptions
};

// Initialize on page load (only if not disabled via data attribute)
if (typeof window !== 'undefined') {
    const initializeTranslator = () => {
        // Check if auto-init is disabled
        const disableAutoInit = document.documentElement.hasAttribute('data-autopilot-no-auto-init') ||
                               document.querySelector('meta[name="autopilot-no-auto-init"]');
        
        if (disableAutoInit) {
            return; // Skip auto-initialization
        }
        
        const urlParams = new URLSearchParams(window.location.search);
        const lng = urlParams.get('lng') || localStorage.getItem('app_language') || 'en';
        
        // Get enabled pages from meta tag or default
        const enabledPagesMeta = document.querySelector('meta[name="translation-enabled-pages"]');
        const enabledPagesContent = enabledPagesMeta?.getAttribute('content') || '';
        const enabledPages = enabledPagesContent === '*' || enabledPagesContent === ''
            ? [] // Empty array means all pages enabled
            : enabledPagesContent.split(',').map(p => p.trim()).filter(p => p);
        
        autopilotTranslator.init(lng, enabledPages);
    };
    
    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initializeTranslator);
    } else {
        initializeTranslator();
    }
    
    // Also initialize immediately (for SPA navigation)
    initializeTranslator();
}

