/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record','./abj_utils_privy_create_integration_log_record','N/runtime','N/search'], (record, integrationLogRecord, runtime, search) => {

    const get = (context) => {
        return { message: 'GET request received', params: context };
    };

    const cleanInternalId = (string) =>{
      // remove any non-digit characters inluding spaces
      log.debug('string', string);
      if(typeof string === 'number'){
        return string;
      }
      
      if(!string || string == undefined || string == null || string == ''){
        return '';
      }
      const val = string.replace(/\D/g, '');
      const num = val ? parseInt(val) : '';
      return num;
    }

    const generateResponse = ({statusParam, message, refNumber, id}) => {
        log.debug('status oparam', statusParam)
        let statusCode = statusParam ? 200 : 400;
        let status = statusParam ? "success" : "failed";
        return {
            "status_code": statusCode,
            "status": status,
            "message": message,
            "data": {
                "ref_number": refNumber,
                "internal_id" : id
            }
        }
    }

    const setFieldValue = (rec,fieldId, value) =>{
        if(value){
            rec.setValue({
                fieldId : fieldId,
                value : value
            })
        }
    }

    const setSublistFieldValue = (rec,sublistId,fieldId, value, line) =>{
        if(value != null && value != undefined && value != ''){
            rec.setSublistValue({
                sublistId : sublistId,
                fieldId : fieldId,
                value : value,
                line : line
            })
        }
    }

    const seachCustomerByCusHierarchy = (custHier) =>{
        var lookupCust = search.lookupFields({
            type: 'customrecord_abj_privy_cust_hierarchy',
            id: custHier,
            columns: ['custrecord_abj_customer_link']
        });

        log.debug('search customer', lookupCust);
        if (!lookupCust && lookupCust.custrecord_abj_customer_link) {
           return false;
        }

        return lookupCust.custrecord_abj_customer_link[0].value;
    }

    let formatDate = (dateString) =>{
        if(!dateString || dateString == undefined || dateString == null || dateString == ''){
            return '';
        }
        const date = new Date(dateString);
        log.debug('date', date);
        return date;
    }

    const createUsageRecord = (data) =>{
        try {
            if(data.transaction_type !== 'usage'){
                return {
                    status: false,
                    message: 'Invalid transaction type. Only "usage" is allowed.',
                    id: null
                }
            }
            let rec = record.create({
                type : 'customsale_abj_usage_pre_postpaid',
            });

            if(!data?.data?.customer_hierarchy_id){
                return {
                    status: false,
                    message: 'customer_hierarchy_id is requireds.',
                    id: null
                }
            }

            let customer = seachCustomerByCusHierarchy(data?.data?.customer_hierarchy_id);
            log.debug('customer', customer);
            if(!customer){
               return {
                    status: false,
                    message: 'customer not found, customer_hierarchy_id : '+ data?.data?.customer_hierarchy_id,
                    id: null
                } 
            }

            log.debug('data',data.data);
            log.debug('data?.customer_hierarchy?', data?.data?.customer_hierarchy_id);
            log.debug('data?.customer_hierarchy_config?', data?.data?.customer_hierarchy_config_id);
            // setFieldValue(rec,'customform', 170);
            setFieldValue(rec,'entity',customer);
            setFieldValue(rec,'custbody_abj_hierarchy_customer_', cleanInternalId(data?.data?.customer_hierarchy_id));
            setFieldValue(rec,'custbody_abj_id_cust_hierarchy_con', cleanInternalId(data?.data?.customer_hierarchy_config_id));
            setFieldValue(rec,'trandate', formatDate(data?.data?.trandate));
            setFieldValue(rec,'custbody_abj_pg_order_id', data?.data?.order_id); //
            setFieldValue(rec,'custbody_abj_usage_ref_number', data?.data?.ref_number);
            


            let account = rec.getValue('account');
            let exchangeRate = rec.getValue('exchangerate');
            let currency = rec.getValue('currency');

            log.debug('account',account)

            setFieldValue(rec, 'account', account);
            setFieldValue(rec, 'exchangerate', exchangeRate);
            setFieldValue(rec,'currency', data?.data?.currency_id);
            // setFieldValue(rec, 'currency', currency);


            // let order_items = data?.data?.order_items;
            // for (let i = 0; i < order_items.length; i++) {
            //     let rowData = order_items[i];
            //     setSublistFieldValue(rec, 'item','item', cleanInternalId(rowData?.item_id), i);
            //     setSublistFieldValue(rec, 'item','quantity', rowData.quantity, i);
            // }
            let i =0;
            setSublistFieldValue(rec, 'item','item', cleanInternalId(data?.data?.item_id), i);
            setSublistFieldValue(rec, 'item','quantity', data?.data?.quantity, i);

            log.debug('saving', 'progresss');
            let recId = rec.save();
            log.debug('saving', 'done'+recId);
            return {
                status : true,
                message : 'Usage created successfully.',
                id : recId
            }
        } catch (error) {
            return {
                status : false,
                message : error.message,
                id : null
            }
        }
    }
    const updateUsageRecord = (data) =>{
        try {
            if(data.transaction_type !== 'usage'){
                return {
                    status: false,
                    message: 'Invalid transaction type. Only "usage" is allowed.',
                    id: null
                }
            }
            if(!data?.data?.rec_id){
                return {
                    status: false,
                    message: 'rec_id is required for update usage.',
                    id: null
                }
            }
            let rec = record.load({
                type : 'customsale_abj_usage_pre_postpaid',
                id : data?.data?.rec_id
            });

            if(!data?.data?.customer_hierarchy_id){
                return {
                    status: false,
                    message: 'customer_hierarchy_id is requireds.',
                    id: null
                }
            }

            let customer = seachCustomerByCusHierarchy(data?.data?.customer_hierarchy_id);
            log.debug('customer', customer);
            if(!customer){
               return {
                    status: false,
                    message: 'customer not found, customer_hierarchy_id : '+ data?.data?.customer_hierarchy_id,
                    id: null
                } 
            }

            log.debug('data',data.data);
            log.debug('data?.customer_hierarchy?', data?.data?.customer_hierarchy_id);
            log.debug('data?.customer_hierarchy_config?', data?.data?.customer_hierarchy_config_id);
            // setFieldValue(rec,'customform', 170);
            setFieldValue(rec,'entity',customer);
            setFieldValue(rec,'custbody_abj_hierarchy_customer_', cleanInternalId(data?.data?.customer_hierarchy_id));
            setFieldValue(rec,'custbody_abj_id_cust_hierarchy_con', cleanInternalId(data?.data?.customer_hierarchy_config_id));
            setFieldValue(rec,'trandate', formatDate(data?.data?.trandate));
            setFieldValue(rec,'custbody_abj_pg_order_id', data?.data?.order_id); //
            setFieldValue(rec,'custbody_abj_usage_ref_number', data?.data?.ref_number);

            let account = rec.getValue('account');
            let exchangeRate = rec.getValue('exchangerate');
            let currency = rec.getValue('currency');

            log.debug('account',account)

            setFieldValue(rec, 'account', account);
            setFieldValue(rec, 'exchangerate', exchangeRate);
            setFieldValue(rec, 'currency', currency);


            let order_items = data?.data?.order_items;
            for (let i = 0; i < order_items.length; i++) {
                let rowData = order_items[i];
                setSublistFieldValue(rec, 'item','item', cleanInternalId(rowData?.item_id), i);
                setSublistFieldValue(rec, 'item','quantity', rowData.quantity, i);
                // setSublistFieldValue(rec, 'item','price', -1, i);
                // setSublistFieldValue(rec, 'item','rate', rowData.final_unit_price || 1000, i);
                // setSublistFieldValue(rec, 'item','amount', rowData.final_amount || 1000, i);
            }

            log.debug('saving', 'progresss');
            let recId = rec.save();
            log.debug('saving', 'done'+recId);
            return {
                status : true,
                message : 'Usage updated successfully.',
                id : recId
            }
        } catch (error) {
            return {
                status : false,
                message : error.message,
                id : null
            }
        }
    }

    const post = (context) => {
        log.debug('context', context)

        let usage = createUsageRecord(context);
        log.debug('usage', usage);

        let response = generateResponse({ 
            statusParam : usage.status, 
            message : usage.message,
            refNumber : context?.data?.ref_number,
            id : usage.id
        });

        var integrationLogRecordId = context.log_id || null;
        const scriptObj = runtime.getCurrentScript();
        var scriptId = scriptObj.id;
        var deploymentId = scriptObj.deploymentId;
        const integrationLogRec = integrationLogRecord.createSOSIntegrationLog({
          jobName: 'ABJ RS | CREATE USAGE',
          jobType: 'Restlet - POST',
          jobLink: 'JOB LINK - URL DARI POS',
          reqBody: JSON.stringify(context),
          resBody: JSON.stringify(response),
          linkTrx: usage.id,
          status : usage.status,
          logId : integrationLogRecordId,
          scriptId : scriptId,
          deploymentId : deploymentId,
          tranETPNumber : context?.data?.tran_etp || ''
        });
        return response;
    };

    const put = (context) =>{
        log.debug('context', context)

        let usage = updateUsageRecord(context);
        log.debug('usage', usage);

        let response = generateResponse({ 
            statusParam : usage.status, 
            message : usage.message,
            refNumber : context?.data?.ref_number,
            id : usage.id
        });

        var integrationLogRecordId = context.log_id || null;
        const scriptObj = runtime.getCurrentScript();
        var scriptId = scriptObj.id;
        var deploymentId = scriptObj.deploymentId;
        const integrationLogRec = integrationLogRecord.createSOSIntegrationLog({
          jobName: 'ABJ RS | UPDATE USAGE',
          jobType: 'Restlet - PUT',
          jobLink: 'JOB LINK - URL DARI POS',
          reqBody: JSON.stringify(context),
          resBody: JSON.stringify(response),
          linkTrx: usage.id,
          status : usage.status,
          logId : integrationLogRecordId,
          scriptId : scriptId,
          deploymentId : deploymentId,
          tranETPNumber : context?.data?.tran_etp || ''
        });
        return response;
    }

    return { 
        post,
        // put 
    };
});
