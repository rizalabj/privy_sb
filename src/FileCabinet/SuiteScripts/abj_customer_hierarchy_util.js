/**
 * @NApiVersion 2.1
 */
define(['N/log', 'N/record', 'N/search'], (log, record, search) => {
    const HIERARCHY_SEARCH_ID = 'customsearch_abj_load_record_hierarchy';
    const CONFIG_SEARCH_ID = 'customsearch_abj_load_rec_hierar_config';
    const HIERARCHY_RECORD_TYPE = 'customrecord_abj_privy_cust_hierarchy';
    const CONFIG_RECORD_TYPE = 'customrecord_abj_customer_hierar_config';
    const MAX_RESULTS = 1000;

    const addCustomerFilter = (savedSearch, customerId, fieldId) => {
        const customerFilter = search.createFilter({
            name: fieldId,
            operator: search.Operator.ANYOF,
            values: [String(customerId)],
        });

        const existingFilters = savedSearch.filters || [];
        existingFilters.push(customerFilter);
        savedSearch.filters = existingFilters;
    };

    const runSavedSearch = (searchId, customerId, fieldId) => {
        const savedSearch = search.load({
            id: searchId,
        });

        addCustomerFilter(savedSearch, customerId, fieldId);

        return (
            savedSearch.run().getRange({
                start: 0,
                end: MAX_RESULTS,
            }) || []
        );
    };

    const getTargetRecordId = (result) => {
        return result.id || result.getValue({ name: 'internalid' });
    };

    const getTargetRecordType = (result, fallbackType) => {
        return result.recordType || fallbackType;
    };

    const getFieldText = (loadedRecord, fieldId) => {
        const value = loadedRecord.getValue({ fieldId });

        if (value === null || value === '' || typeof value === 'undefined') {
            return '';
        }

        const textValue = loadedRecord.getText({ fieldId });

        if (Array.isArray(textValue)) {
            return textValue.join(', ');
        }

        if (
            textValue !== null &&
            textValue !== '' &&
            typeof textValue !== 'undefined'
        ) {
            return String(textValue).trim();
        }

        return String(value).trim();
    };

    const joinNonEmptyValues = (values, separator) => {
        return values
            .map((value) =>
                value === null || typeof value === 'undefined'
                    ? ''
                    : String(value).trim()
            )
            .filter((value) => value !== '')
            .join(separator);
    };

    const buildHierarchyName = (loadedRecord) => {
        const hierarchyPairs = [
            ['custrecord_abj_channel_id', 'custrecord_abj_channel_name'],
            ['custrecord_abj_application_id', 'custrecord_abj_application_name'],
            ['custrecord_abj_merchant_id', 'custrecord_abj_merchant_name'],
            ['custrecord_abj_enterprise_id', 'custrecord_abj_enterprise_name'],
        ];

        for (let i = 0; i < hierarchyPairs.length; i += 1) {
            const [idField, nameField] = hierarchyPairs[i];
            const idValue = loadedRecord.getValue({ fieldId: idField });
            const nameValue = loadedRecord.getValue({ fieldId: nameField });

            if (
                idValue !== null &&
                idValue !== '' &&
                typeof idValue !== 'undefined' &&
                nameValue !== null &&
                nameValue !== '' &&
                typeof nameValue !== 'undefined'
            ) {
                return `${String(idValue).trim()} - ${String(nameValue).trim()}`;
            }
        }

        return '';
    };

    const buildConfigName = (loadedRecord) => {
        return joinNonEmptyValues(
            [
                getFieldText(loadedRecord, 'custrecord_abj_customer_link_config'),
                getFieldText(loadedRecord, 'custrecord_abj_hie_con_integration_type'),
                getFieldText(loadedRecord, 'custrecord_abj_hie_con_label_address'),
            ],
            ' - '
        );
    };

    const buildConfigAddressText = (loadedRecord) => {
        return joinNonEmptyValues(
            [
                loadedRecord.getValue({
                    fieldId: 'custrecord_abj_hie_con_street_address',
                }),
                loadedRecord.getValue({ fieldId: 'custrecord_abj_hie_con_city' }),
                loadedRecord.getValue({
                    fieldId: 'custrecord_abj_hie_con_province',
                }),
                loadedRecord.getValue({
                    fieldId: 'custrecord_abj_hie_con_country',
                }),
                loadedRecord.getValue({
                    fieldId: 'custrecord_abj_hie_con_zip_code',
                }),
            ],
            ' '
        );
    };

    const applyRecordUpdates = (loadedRecord, recordType) => {
        if (recordType === HIERARCHY_RECORD_TYPE) {
            const hierarchyName = buildHierarchyName(loadedRecord);

            if (hierarchyName) {
                loadedRecord.setValue({
                    fieldId: 'name',
                    value: hierarchyName,
                });
            }

            return;
        }

        if (recordType === CONFIG_RECORD_TYPE) {
            const configName = buildConfigName(loadedRecord);
            const addressText = buildConfigAddressText(loadedRecord);

            if (configName) {
                loadedRecord.setValue({
                    fieldId: 'name',
                    value: configName,
                });
            }

            loadedRecord.setValue({
                fieldId: 'custrecord_abj_address_text_area',
                value: addressText,
            });
        }
    };

    const saveLoadedRecord = (recordType, recordId) => {
        if (!recordType || !recordId) {
            return null;
        }

        const loadedRecord = record.load({
            type: recordType,
            id: recordId,
            isDynamic: false,
        });

        applyRecordUpdates(loadedRecord, recordType);

        return loadedRecord.save({
            enableSourcing: true,
            ignoreMandatoryFields: false,
        });
    };

    const processSearchResults = (results, fallbackType) => {
        const savedRecordIds = [];

        results.forEach((result) => {
            const targetRecordId = getTargetRecordId(result);
            const targetRecordType = getTargetRecordType(result, fallbackType);

            if (!targetRecordId || !targetRecordType) {
                log.debug('Skipping search result with incomplete target data', {
                    targetRecordId,
                    targetRecordType,
                });
                return;
            }

            const savedId = saveLoadedRecord(targetRecordType, targetRecordId);
            savedRecordIds.push({
                recordType: targetRecordType,
                recordId: targetRecordId,
                savedId,
            });
        });

        return savedRecordIds;
    };

    const processCustomerHierarchy = ({ customerId }) => {
        const hierarchyResults = runSavedSearch(
            HIERARCHY_SEARCH_ID,
            customerId,
            'custrecord_abj_customer_link'
        );
        const configResults = runSavedSearch(
            CONFIG_SEARCH_ID,
            customerId,
            'custrecord_abj_id_customer'
        );

        const hierarchySaved = processSearchResults(
            hierarchyResults,
            HIERARCHY_RECORD_TYPE
        );
        const configSaved = processSearchResults(
            configResults,
            CONFIG_RECORD_TYPE
        );

        return {
            hierarchyProcessed: hierarchySaved.length,
            configProcessed: configSaved.length,
            hierarchySaved,
            configSaved,
        };
    };

    return {
        processCustomerHierarchy,
    };
});