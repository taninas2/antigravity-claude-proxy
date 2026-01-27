/**
 * Account Storage
 *
 * Handles loading and saving account configuration to disk.
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { dirname } from 'path';
import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { getAuthStatus } from '../auth/database.js';
import { logger } from '../utils/logger.js';

/**
 * Load accounts from the config file
 *
 * @param {string} configPath - Path to the config file
 * @returns {Promise<{accounts: Array, settings: Object, activeIndex: number}>}
 */
export async function loadAccounts(configPath = ACCOUNT_CONFIG_PATH) {
    try {
        // Check if config file exists using async access
        await access(configPath, fsConstants.F_OK);
        const configData = await readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);

        const accounts = (config.accounts || []).map(acc => ({
            ...acc,
            lastUsed: acc.lastUsed || null,
            enabled: acc.enabled !== false, // Default to true if not specified
            // Reset invalid flag on startup - give accounts a fresh chance to refresh
            isInvalid: false,
            invalidReason: null,
            modelRateLimits: acc.modelRateLimits || {},
            // New fields for subscription and quota tracking
            subscription: acc.subscription || { tier: 'unknown', projectId: null, detectedAt: null },
            quota: acc.quota || { models: {}, lastChecked: null }
        }));

        const settings = config.settings || {};
        let activeIndex = config.activeIndex || 0;

        // Clamp activeIndex to valid range
        if (activeIndex >= accounts.length) {
            activeIndex = 0;
        }

        logger.info(`[AccountManager] Loaded ${accounts.length} account(s) from config`);

        return { accounts, settings, activeIndex };
    } catch (error) {
        if (error.code === 'ENOENT') {
            // No config file - return empty
            logger.info('[AccountManager] No config file found. Using Antigravity database (single account mode)');
        } else {
            logger.error('[AccountManager] Failed to load config:', error.message);
        }
        return { accounts: [], settings: {}, activeIndex: 0 };
    }
}

/**
 * Load the default account from Antigravity's database
 *
 * @param {string} dbPath - Optional path to the database
 * @returns {{accounts: Array, tokenCache: Map}}
 */
export function loadDefaultAccount(dbPath) {
    try {
        const authData = getAuthStatus(dbPath);
        if (authData?.apiKey) {
            const account = {
                email: authData.email || 'default@antigravity',
                source: 'database',
                lastUsed: null,
                modelRateLimits: {}
            };

            const tokenCache = new Map();
            tokenCache.set(account.email, {
                token: authData.apiKey,
                extractedAt: Date.now()
            });

            logger.info(`[AccountManager] Loaded default account: ${account.email}`);

            return { accounts: [account], tokenCache };
        }
    } catch (error) {
        logger.error('[AccountManager] Failed to load default account:', error.message);
    }

    return { accounts: [], tokenCache: new Map() };
}

/**
 * Load accounts from PROXY_ACCOUNTS environment variable
 * Format: JSON array with objects containing email and refresh_token or api_key
 * Example: [{"email":"test@example.com","refresh_token":"xxx"},{"email":"user@gmail.com","api_key":"sk-xxx"}]
 *
 * @returns {Array} accounts - Array of account objects loaded from env
 */
export function loadAccountsFromEnv() {
    const envAccounts = process.env.PROXY_ACCOUNTS;
    if (!envAccounts) {
        return [];
    }

    try {
        const parsed = JSON.parse(envAccounts);
        if (!Array.isArray(parsed)) {
            logger.warn('[AccountManager] PROXY_ACCOUNTS env var must be a JSON array');
            return [];
        }

        const accounts = [];
        for (const acc of parsed) {
            if (!acc.email) {
                logger.warn('[AccountManager] Skipping env account without email');
                continue;
            }

            // Support both snake_case and camelCase
            const refreshToken = acc.refresh_token || acc.refreshToken;
            const apiKey = acc.api_key || acc.apiKey;

            if (!refreshToken && !apiKey) {
                logger.warn(`[AccountManager] Skipping env account ${acc.email}: missing refresh_token or api_key`);
                continue;
            }

            accounts.push({
                email: acc.email,
                source: apiKey ? 'manual' : 'oauth',
                refreshToken: refreshToken,
                apiKey: apiKey,
                enabled: true,
                isInvalid: false,
                invalidReason: null,
                modelRateLimits: {},
                lastUsed: null,
                addedAt: new Date().toISOString(),
                fromEnv: true  // Mark as loaded from env
            });
        }

        if (accounts.length > 0) {
            logger.info(`[AccountManager] Loaded ${accounts.length} account(s) from PROXY_ACCOUNTS env var`);
        }

        return accounts;
    } catch (error) {
        logger.error('[AccountManager] Failed to parse PROXY_ACCOUNTS env var:', error.message);
        return [];
    }
}

/**
 * Save account configuration to disk
 *
 * @param {string} configPath - Path to the config file
 * @param {Array} accounts - Array of account objects
 * @param {Object} settings - Settings object
 * @param {number} activeIndex - Current active account index
 */
export async function saveAccounts(configPath, accounts, settings, activeIndex) {
    try {
        // Ensure directory exists
        const dir = dirname(configPath);
        await mkdir(dir, { recursive: true });

        const config = {
            accounts: accounts.map(acc => ({
                email: acc.email,
                source: acc.source,
                enabled: acc.enabled !== false, // Persist enabled state
                dbPath: acc.dbPath || null,
                refreshToken: acc.source === 'oauth' ? acc.refreshToken : undefined,
                apiKey: acc.source === 'manual' ? acc.apiKey : undefined,
                projectId: acc.projectId || undefined,
                addedAt: acc.addedAt || undefined,
                isInvalid: acc.isInvalid || false,
                invalidReason: acc.invalidReason || null,
                modelRateLimits: acc.modelRateLimits || {},
                lastUsed: acc.lastUsed,
                // Persist subscription and quota data
                subscription: acc.subscription || { tier: 'unknown', projectId: null, detectedAt: null },
                quota: acc.quota || { models: {}, lastChecked: null }
            })),
            settings: settings,
            activeIndex: activeIndex
        };

        await writeFile(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
        logger.error('[AccountManager] Failed to save config:', error.message);
    }
}
