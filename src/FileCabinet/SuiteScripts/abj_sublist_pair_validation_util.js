/**
 * @NApiVersion 2.1
 */
define([], () => {
    const DEFAULT_FIELD_PAIRS = [
        ['custrecord_abj_application_id', 'custrecord_abj_application_name'],
        ['custrecord_abj_merchant_id', 'custrecord_abj_merchant_name'],
        ['custrecord_abj_enterprise_id', 'custrecord_abj_enterprise_name'],
        ['custrecord_abj_channel_id','custrecord_abj_channel_name']
    ];

    /**
     * Returns true when the supplied value should be treated as filled in.
     *
     * @param {string | number | boolean | Date | string[] | number[] | null | undefined} value
     * @returns {boolean}
     */
    const hasValue = (value) => {
        if (value === null || value === undefined) {
            return false;
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        if (typeof value === 'string') {
            return value.trim() !== '';
        }

        return true;
    };

    /**
     * Converts a field ID into a readable fallback label.
     *
     * @param {string} fieldId
     * @returns {string}
     */
    const toReadableFieldLabel = (fieldId) =>
        fieldId
            .replace(/^custrecord_/, '')
            .replace(/^custcol_/, '')
            .replace(/^custbody_/, '')
            .replace(/^custentity_/, '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');

    /**
     * Returns the best available label for a sublist field.
     *
     * @param {import('N/record').Record} record
     * @param {string} sublistId
     * @param {string} fieldId
     * @returns {string}
     */
    const getSublistFieldLabel = (record, sublistId, fieldId) => {
        try {
            const field = record.getSublistField({
                sublistId,
                fieldId,
                line: 0,
            });

            if (field?.label) {
                return field.label;
            }
        } catch (sublistFieldError) {
            // Fallback to a readable label when the field metadata is not available.
        }

        return toReadableFieldLabel(fieldId);
    };

    /**
     * Builds a readable validation error message.
     *
     * @param {string} sourceFieldLabel
     * @param {string} requiredFieldLabel
     * @param {number} lineNumber
     * @returns {string}
     */
    const buildLineErrorMessage = (sourceFieldLabel, requiredFieldLabel, lineNumber) =>
        `<br/>- Row ${lineNumber}: please enter "${requiredFieldLabel}" after selecting "${sourceFieldLabel}".`;

    /**
     * Builds the final user-facing validation message.
     *
     * @param {string[]} validationMessages
     * @returns {string}
     */
    const buildValidationSummaryMessage = (validationMessages) =>
        [
            'Unable to save this record because some hierarchy information is incomplete.<br/>',
            'Please review the rows below:<br/>',
            ...validationMessages.map((message) => `${message}`),
        ].join('\n');

    /**
     * Validates configured field pairs on a sublist and throws a User Event error if invalid.
     *
     * @param {Object} options
     * @param {import('N/record').Record} options.record
     * @param {string} options.sublistId
     * @param {string[][]} [options.fieldPairs]
     * @param {string} [options.errorName]
     */
    const validateSublistPairs = (options) => {
        const {
            record,
            sublistId,
            fieldPairs = DEFAULT_FIELD_PAIRS,
        } = options;

        const lineCount = record.getLineCount({
            sublistId,
        });

        /** @type {string[]} */
        const validationMessages = [];

        const fieldLabelMap = fieldPairs.reduce((labels, [sourceFieldId, requiredFieldId]) => {
            if (!labels[sourceFieldId]) {
                labels[sourceFieldId] = getSublistFieldLabel(record, sublistId, sourceFieldId);
            }

            if (!labels[requiredFieldId]) {
                labels[requiredFieldId] = getSublistFieldLabel(record, sublistId, requiredFieldId);
            }

            return labels;
        }, {});

        for (let line = 0; line < lineCount; line += 1) {
            fieldPairs.forEach(([sourceFieldId, requiredFieldId]) => {
                const sourceValue = record.getSublistValue({
                    sublistId,
                    fieldId: sourceFieldId,
                    line,
                });

                const requiredValue = record.getSublistValue({
                    sublistId,
                    fieldId: requiredFieldId,
                    line,
                });

                if (hasValue(sourceValue) && !hasValue(requiredValue)) {
                    validationMessages.push(
                        buildLineErrorMessage(
                            fieldLabelMap[sourceFieldId],
                            fieldLabelMap[requiredFieldId],
                            line + 1,
                        ),
                    );
                }
            });
        }

        if (validationMessages.length > 0) {
            throw buildValidationSummaryMessage(validationMessages);
        }
    };

    return {
        DEFAULT_FIELD_PAIRS,
        validateSublistPairs,
    };
});