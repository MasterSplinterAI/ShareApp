/**
 * Language Selector Component
 * A reusable language selector that can be used standalone or integrated into existing UI
 */

import { SUPPORTED_LANGUAGES, Language, getLanguage } from './languages';

export interface LanguageSelectorOptions {
    container?: HTMLElement | string; // CSS selector or element
    currentLanguage?: string;
    onLanguageChange?: (languageCode: string) => void;
    showFlags?: boolean;
    showNativeNames?: boolean;
    style?: 'dropdown' | 'buttons' | 'list';
    className?: string;
}

export class LanguageSelector {
    private container: HTMLElement;
    private currentLanguage: string;
    private onLanguageChange?: (languageCode: string) => void;
    private showFlags: boolean;
    private showNativeNames: boolean;
    private style: 'dropdown' | 'buttons' | 'list';
    private className: string;
    private element: HTMLElement | null = null;

    constructor(options: LanguageSelectorOptions = {}) {
        // Resolve container
        if (typeof options.container === 'string') {
            const found = document.querySelector(options.container);
            if (!found) {
                throw new Error(`Container not found: ${options.container}`);
            }
            this.container = found as HTMLElement;
        } else if (options.container) {
            this.container = options.container;
        } else {
            // Create default container
            this.container = document.body;
        }

        this.currentLanguage = options.currentLanguage || 'en';
        this.onLanguageChange = options.onLanguageChange;
        this.showFlags = options.showFlags !== false;
        this.showNativeNames = options.showNativeNames !== false;
        this.style = options.style || 'dropdown';
        this.className = options.className || 'autopilot-language-selector';
    }

    /**
     * Render the language selector
     */
    public render(): HTMLElement {
        if (this.element) {
            this.element.remove();
        }

        switch (this.style) {
            case 'dropdown':
                this.element = this.renderDropdown();
                break;
            case 'buttons':
                this.element = this.renderButtons();
                break;
            case 'list':
                this.element = this.renderList();
                break;
        }

        this.container.appendChild(this.element);
        return this.element;
    }

    /**
     * Update current language
     */
    public setLanguage(languageCode: string): void {
        this.currentLanguage = languageCode;
        if (this.element) {
            this.render(); // Re-render with new language
        }
    }

    /**
     * Get current language
     */
    public getLanguage(): string {
        return this.currentLanguage;
    }

    /**
     * Render dropdown style selector
     */
    private renderDropdown(): HTMLElement {
        const select = document.createElement('select');
        select.className = this.className;
        select.value = this.currentLanguage;

        SUPPORTED_LANGUAGES.forEach(lang => {
            const option = document.createElement('option');
            option.value = lang.code;
            let label = lang.name;
            if (this.showNativeNames && lang.nativeName !== lang.name) {
                label += ` (${lang.nativeName})`;
            }
            if (this.showFlags && lang.flag) {
                label = `${lang.flag} ${label}`;
            }
            option.textContent = label;
            select.appendChild(option);
        });

        select.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.currentLanguage = target.value;
            if (this.onLanguageChange) {
                this.onLanguageChange(this.currentLanguage);
            }
        });

        return select;
    }

    /**
     * Render buttons style selector
     */
    private renderButtons(): HTMLElement {
        const container = document.createElement('div');
        container.className = `${this.className} ${this.className}--buttons`;

        SUPPORTED_LANGUAGES.forEach(lang => {
            const button = document.createElement('button');
            button.className = `${this.className}__button`;
            if (lang.code === this.currentLanguage) {
                button.classList.add(`${this.className}__button--active`);
            }

            let label = lang.name;
            if (this.showNativeNames && lang.nativeName !== lang.name) {
                label += ` (${lang.nativeName})`;
            }
            if (this.showFlags && lang.flag) {
                label = `${lang.flag} ${label}`;
            }
            button.textContent = label;
            button.setAttribute('data-language', lang.code);

            button.addEventListener('click', () => {
                this.currentLanguage = lang.code;
                if (this.onLanguageChange) {
                    this.onLanguageChange(lang.code);
                }
                // Update active state
                container.querySelectorAll(`.${this.className}__button`).forEach(btn => {
                    btn.classList.remove(`${this.className}__button--active`);
                });
                button.classList.add(`${this.className}__button--active`);
            });

            container.appendChild(button);
        });

        return container;
    }

    /**
     * Render list style selector
     */
    private renderList(): HTMLElement {
        const list = document.createElement('ul');
        list.className = `${this.className} ${this.className}--list`;

        SUPPORTED_LANGUAGES.forEach(lang => {
            const item = document.createElement('li');
            item.className = `${this.className}__item`;
            if (lang.code === this.currentLanguage) {
                item.classList.add(`${this.className}__item--active`);
            }

            let label = lang.name;
            if (this.showNativeNames && lang.nativeName !== lang.name) {
                label += ` (${lang.nativeName})`;
            }
            if (this.showFlags && lang.flag) {
                label = `${lang.flag} ${label}`;
            }
            item.textContent = label;
            item.setAttribute('data-language', lang.code);

            item.addEventListener('click', () => {
                this.currentLanguage = lang.code;
                if (this.onLanguageChange) {
                    this.onLanguageChange(lang.code);
                }
                // Update active state
                list.querySelectorAll(`.${this.className}__item`).forEach(li => {
                    li.classList.remove(`${this.className}__item--active`);
                });
                item.classList.add(`${this.className}__item--active`);
            });

            list.appendChild(item);
        });

        return list;
    }

    /**
     * Destroy the selector
     */
    public destroy(): void {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}

/**
 * Create a simple language selector (helper function)
 */
export function createLanguageSelector(
    container: HTMLElement | string,
    options: Omit<LanguageSelectorOptions, 'container'> = {}
): LanguageSelector {
    return new LanguageSelector({
        container,
        ...options
    });
}

