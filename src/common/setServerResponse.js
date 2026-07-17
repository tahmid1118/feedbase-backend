

const fs = require('fs');
const path = require('path');


/**
 * @param {number} code 
 * @param {string} msgKey 
 * @param {string} language 
 * @param {number} [result] 
 * @description This function is used to send messages (success or error) with status code, based on language and a JSON file for translations. Optionally includes result.
 */
const setServerResponse = (code, msgKey, language, result = null) => {
    // Path to the JSON file containing translations
    const translationsPath = path.join(__dirname, '../common/response-message.json');

    let translations;
    try {
        const fileContent = fs.readFileSync(translationsPath, 'utf-8');
        translations = JSON.parse(fileContent);
    } catch (error) {
        throw new Error('Unable to load translations file.');
    }

    const en = translations['en'] || {};
    const langMessages = translations[language] || en;

    // Per-key fallback to English: a supported language may translate only some
    // keys (the rest fall back to English), so a partial translation never shows
    // a raw key or a placeholder. English is the source of truth.
    const message = langMessages[msgKey] || en[msgKey] || msgKey;

    // Determine success or error status
    const statusType = code >= 200 && code < 300 ? 'success' : 'failed';
    // const statusType = code >= 200 && code < 300 ? langMessages.success : langMessages.failed;

    const response = {
        statusCode: code,
        status: statusType,
        message
    };

    if (result !== null) {
        response.result = result;
    }

    return response;
};

module.exports = {
    setServerResponse
};