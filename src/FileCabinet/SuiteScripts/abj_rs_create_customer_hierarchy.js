/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */


define(['N/record', 'N/log', 'N/error', 'N/format', 'N/search', 'N/runtime', 'N/query'], (record, log, error, format, search, runtime, query) => {

    function createLog(req, resp, trx, status, refnumber, isDataWH) {
        var recLog = record.create({
            type: 'customtransaction_abj_log_integratio'
        })
        const scriptObj = runtime.getCurrentScript()
        var scriptId = scriptObj.id
        var deploymentId = scriptObj.deploymentId

        recLog.setValue('custbody_abj_integlog_job_name', 'ABJ RS | CREATE CUST HIERARCHY')
        recLog.setValue('custbody_abj_integlog_job_type', 'Restlet - POST')
        recLog.setValue('custbody_abj_integlog_job_link', 'URL Endpoint')
        recLog.setValue('custbody_abj_integlog_request_body', req)
        recLog.setValue('custbody_abj_integlog_response_body', resp)
        // recLog.setValue('custbody_abj_integlog_trx_number', trx)
        recLog.setValue('custbody_abj_integlog_cust_hierarchy', trx)
        recLog.setValue('custbody_abj_integlog_status', status)
        recLog.setValue('custbody_abj_usage_ref_number', refnumber)
        recLog.setValue('custbody_abj_integlog_isdatawarehouse', isDataWH)
        recLog.setValue('custbody_abj_integlog_script_id', scriptId)
        recLog.setValue('custbody_abj_integlog_deploy_script_id', deploymentId)

        var recLogSave = recLog.save()
        log.debug('recLogSave', recLogSave)
    }

    return {
        post: (context) => {
            var refNum = context.data.ref_number
            var npwp = context.data.npwp
            var isDataWH = context.data.is_data_warehouse

            var respData = {
                ref_number: refNum,
                internal_id: null
            }

            var isNewRefNum = false
            var isNewNPWP = false

            try {
                //validasi transaction type
                if (!context.record_type || context.record_type != 'customer_hierarchy') {
                    throw ({
                        message: 'This endpoint only accepts record_type: customer_hierarchy'
                    });
                }

                //validasi ref_num
                var searchRefNum = search.create({
                    type: 'customrecord_abj_privy_cust_hierarchy',
                    filters: [
                        ['custrecord_abj_ref_number', 'is', refNum]
                    ],
                    columns: [
                        'custrecord_abj_ref_number'
                    ]
                })
                var searchRefNumResult = searchRefNum.run().getRange(0, 1)
                if (searchRefNumResult.length > 0) {
                    throw ({
                        message: 'Ref Number: ' + refNum + ' is already exist'
                    });
                } else {
                    isNewRefNum = true
                }

                if (isNewRefNum == true) {
                    var customer_id = context.data.customer_id
                    var level_type_id = context.data.level_type_id
                    var enterprise_id = context.data.enterprise_id
                    var enterprise_name = context.data.enterprise_name
                    var merchant_id = context.data.merchant_id
                    var merchant_name = context.data.merchant_name
                    var application_id = context.data.application_id
                    var application_name = context.data.application_name
                    var channel_id = context.data.channel_id
                    var channel_name = context.data.channel_name
                    var enterprise_id_hierarchy = context.data.enterprise_id_hierarchy
                    var merchant_id_hierarchy = context.data.merchant_id_hierarchy
                    var application_id_hierarchy = context.data.application_id_hierarchy
                    var key_account = context.data.key_account

                    //validation
                    if (!customer_id || customer_id == '' || customer_id == null) {
                        throw ({
                            message: 'customer_id is empty'
                        });
                    }
                    if (!level_type_id || level_type_id == '' || level_type_id == null) {
                        throw ({
                            message: 'level_type_id is empty'
                        });
                    } else {
                        var searchLevelType = search.create({
                            type: 'customlist_abj_level_type_list',
                            filters: [
                                ['internalid', 'is', level_type_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchLevelTypeRun = searchLevelType.run().getRange(0, 1)
                        if (searchLevelTypeRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Level Type with id ' + level_type_id + ' was not found',
                            });
                        }
                    }

                    if(level_type_id == 1){ // Validasi Eterprise
                        if (!enterprise_id || enterprise_id == '' || enterprise_id == null) {
                            throw ({
                                message: 'enterprise_id is empty'
                            });
                        }
                        if (!enterprise_name || enterprise_name == '' || enterprise_name == null) {
                            throw ({
                                message: 'enterprise_name is empty'
                            });
                        }
                    }
                    if(level_type_id == 2){ // Validasi Merchant
                        if (!merchant_id || merchant_id == '' || merchant_id == null) {
                            throw ({
                                message: 'merchant_id is empty'
                            });
                        }
                        if (!merchant_name || merchant_name == '' || merchant_name == null) {
                            throw ({
                                message: 'merchant_name is empty'
                            });
                        }
                    }
                    if(level_type_id == 3){ // Validasi Application
                        if (!application_id || application_id == '' || application_id == null) {
                            throw ({
                                message: 'application_id is empty'
                            });
                        }
                        if (!application_name || application_name == '' || application_name == null) {
                            throw ({
                                message: 'application_name is empty'
                            });
                        }
                    }
                    if(level_type_id == 4){ // Validasi Application
                        if (!channel_id || channel_id == '' || channel_id == null) {
                            throw ({
                                message: 'channel_id is empty'
                            });
                        }
                        if (!channel_name || channel_name == '' || channel_name == null) {
                            throw ({
                                message: 'channel_name is empty'
                            });
                        }
                    }

                    //create record
                    var rec = record.create({
                        type: 'customrecord_abj_privy_cust_hierarchy'
                    })
                    rec.setValue({ fieldId: 'customform', value: 28 }) // 28 Privy Customer Hierarchy Form
                    rec.setValue({ fieldId: 'custrecord_abj_customer_link', value: customer_id })
                    rec.setValue({ fieldId: 'custrecord_abj_level_type', value: level_type_id })
                    rec.setValue({ fieldId: 'custrecord_abj_enterprise_id', value: enterprise_id })
                    rec.setValue({ fieldId: 'custrecord_abj_enterprise_name', value: enterprise_name })
                    rec.setValue({ fieldId: 'custrecord_abj_merchant_id', value: merchant_id })
                    rec.setValue({ fieldId: 'custrecord_abj_merchant_name', value: merchant_name })
                    rec.setValue({ fieldId: 'custrecord_abj_application_id', value: application_id })
                    rec.setValue({ fieldId: 'custrecord_abj_application_name', value: application_name })
                    rec.setValue({ fieldId: 'custrecord_abj_channel_id', value: channel_id })
                    rec.setValue({ fieldId: 'custrecord_abj_channel_name', value: channel_name })
                    rec.setValue({ fieldId: 'custrecord_hierarchy_enterprise', value: enterprise_id_hierarchy })
                    rec.setValue({ fieldId: 'custrecord_abj_hierarchy_merhant', value: merchant_id_hierarchy })
                    rec.setValue({ fieldId: 'custrecord_abj_hierarchy_application', value: application_id_hierarchy })
                    rec.setValue({ fieldId: 'custrecord_abj_ref_number', value: refNum })
                    if (key_account == true) {
                        rec.setValue({ fieldId: 'custentity_abj_key_account', value: true })
                    }

                    var recSave = rec.save()
                    log.debug('recSave', recSave)
                    if (recSave) {
                        var reqBody = JSON.stringify(context, null, 2)
                        // reqBody = reqBody.replace(/ /g, '\u00A0');
                        var respBody = {
                            "status_code": 200,
                            "status": "success",
                            "message": "Customer created successfully.",
                            "data": {
                                "ref_number": refNum,
                                "internal_id": recSave
                            }
                        }

                        // var respBodyText = JSON.stringify(respBody, null, 2).replace(/ /g, '\u00A0');
                        var respBodyText = JSON.stringify(respBody, null, 2)

                        //create log
                        createLog(reqBody, respBodyText, recSave, true, refNum, isDataWH)

                        return respBody
                    }

                }

            } catch (error) {
                log.debug('error', error.message)

                var reqBodyError = JSON.stringify(context, null, 2)
                // reqBodyError = reqBodyError.replace(/\r\n/g, '\n');
                // reqBodyError = reqBodyError.replace(/ /g, '\u00A0');

                var respBodyError = {
                    "status_code": 400,
                    "status": "Failed",
                    "message": error.message,
                    "data": respData
                }
                // var respBodyErrorText = JSON.stringify(respBodyError, null, 2).replace(/ /g, '\u00A0');
                var respBodyErrorText = JSON.stringify(respBodyError, null, 2)

                //create log
                createLog(reqBodyError, respBodyErrorText, null, false, refNum, isDataWH)

                return respBodyError
            }
        }
    };

});
