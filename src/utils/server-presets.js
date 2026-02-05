/**
 * Server Configuration Presets Utility
 *
 * Handles reading and writing server config presets.
 * Location: ~/.config/antigravity-proxy/server-presets.json
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';
import { DEFAULT_SERVER_PRESETS } from '../constants.js';

/**
 * Get the path to the server presets file
 * @returns {string} Absolute path to server-presets.json
 */
export function getServerPresetsPath() {
    return path.join(os.homedir(), '.config', 'antigravity-proxy', 'server-presets.json');
}

/**
 * Read all server config presets.
 * Creates the file with default presets if it doesn't exist.
 * @returns {Promise<Array>} Array of preset objects
 */
export async function readServerPresets() {
    const presetsPath = getServerPresetsPath();
    try {
        const content = await fs.readFile(presetsPath, 'utf8');
        if (!content.trim()) return DEFAULT_SERVER_PRESETS;
        const userPresets = JSON.parse(content);
        // Merge: always include built-in presets (latest version), then user custom presets
        const builtInNames = new Set(DEFAULT_SERVER_PRESETS.map(p => p.name));
        const customPresets = userPresets.filter(p => !builtInNames.has(p.name) && !p.builtIn);
        return [...DEFAULT_SERVER_PRESETS, ...customPresets];
    } catch (error) {
        if (error.code === 'ENOENT') {
            try {
                await fs.mkdir(path.dirname(presetsPath), { recursive: true });
                await fs.writeFile(presetsPath, JSON.stringify(DEFAULT_SERVER_PRESETS, null, 2), 'utf8');
                logger.info(`[ServerPresets] Created presets file with defaults at ${presetsPath}`);
            } catch (writeError) {
                logger.warn(`[ServerPresets] Could not create presets file: ${writeError.message}`);
            }
            return DEFAULT_SERVER_PRESETS;
        }
        if (error instanceof SyntaxError) {
            logger.error(`[ServerPresets] Invalid JSON in presets at ${presetsPath}. Returning defaults.`);
            return DEFAULT_SERVER_PRESETS;
        }
        logger.error(`[ServerPresets] Failed to read presets at ${presetsPath}:`, error.message);
        throw error;
    }
}

/**
 * Save a custom server preset (add or update).
 * Rejects overwriting built-in presets.
 * @param {string} name - Preset name
 * @param {Object} config - Server configuration values
 * @returns {Promise<Array>} Updated array of all presets
 */
export async function saveServerPreset(name, config) {
    // Reject overwriting built-in presets
    const builtInNames = new Set(DEFAULT_SERVER_PRESETS.map(p => p.name));
    if (builtInNames.has(name)) {
        throw new Error(`Cannot overwrite built-in preset "${name}"`);
    }

    const presetsPath = getServerPresetsPath();
    let allPresets = await readServerPresets();

    // Find or create user custom preset
    const existingIndex = allPresets.findIndex(p => p.name === name && !p.builtIn);
    const newPreset = { name, config: { ...config } };

    if (existingIndex >= 0) {
        allPresets[existingIndex] = newPreset;
        logger.info(`[ServerPresets] Updated preset: ${name}`);
    } else {
        allPresets.push(newPreset);
        logger.info(`[ServerPresets] Created preset: ${name}`);
    }

    try {
        await fs.mkdir(path.dirname(presetsPath), { recursive: true });
        await fs.writeFile(presetsPath, JSON.stringify(allPresets, null, 2), 'utf8');
    } catch (error) {
        logger.error(`[ServerPresets] Failed to save preset:`, error.message);
        throw error;
    }

    return allPresets;
}

/**
 * Delete a custom server preset by name.
 * Rejects deletion of built-in presets.
 * @param {string} name - Preset name to delete
 * @returns {Promise<Array>} Updated array of all presets
 */
export async function deleteServerPreset(name) {
    // Reject deleting built-in presets
    const builtInNames = new Set(DEFAULT_SERVER_PRESETS.map(p => p.name));
    if (builtInNames.has(name)) {
        throw new Error(`Cannot delete built-in preset "${name}"`);
    }

    const presetsPath = getServerPresetsPath();
    let allPresets = await readServerPresets();

    const originalLength = allPresets.length;
    allPresets = allPresets.filter(p => p.name !== name);

    if (allPresets.length === originalLength) {
        logger.warn(`[ServerPresets] Preset not found: ${name}`);
        return allPresets;
    }

    try {
        await fs.writeFile(presetsPath, JSON.stringify(allPresets, null, 2), 'utf8');
        logger.info(`[ServerPresets] Deleted preset: ${name}`);
    } catch (error) {
        logger.error(`[ServerPresets] Failed to delete preset:`, error.message);
        throw error;
    }

    return allPresets;
}
