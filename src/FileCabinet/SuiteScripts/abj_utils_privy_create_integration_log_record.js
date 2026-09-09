/**
 * @NApiVersion 2.1
 */
define(['N/record'], (record) => {

    const createSOSIntegrationLog = ({
      jobName,jobType,jobLink,reqBody,
      linkTrx,resBody, isUpdate =false,
       linkItem =null, status= false, logId = null,
      scriptId ='', deploymentId = '', tranETPNumber = ''
    }) => {
      try {
        var sosLogRec;
        if(logId){
          sosLogRec = record.load({
            type : 'customtransaction_abj_log_integratio',
            id : logId,
            isDynamic : true
          })
        }else{
          sosLogRec = record.create({
            type: 'customtransaction_abj_log_integratio',
            isDynamic: true
          });

        }

        // sosLogRec.setValue({
        //   fieldId: 'subsidiary',
        //   value: 1
        // });
        sosLogRec.setValue({
          fieldId: 'currency',
          value: 1
        });

        sosLogRec.setValue({
          fieldId: 'exchangerate',
          value: parseFloat(1)
        });
        
  
        sosLogRec.setValue({
          fieldId: 'custbody_abj_integlog_job_name',
          value: jobName
        });
  
        sosLogRec.setValue({
          fieldId: 'trandate',
          value: new Date()
        });
  
        sosLogRec.setValue({
          fieldId: 'custbody_abj_integlog_job_type',
          value: jobType
        });
  
        sosLogRec.setValue({
          fieldId: 'custbody_abj_integlog_job_link',
          value: jobLink
        });
  
        sosLogRec.setValue({
          fieldId: 'custbody_abj_integlog_request_body',
          value: reqBody
        });
  
        sosLogRec.setValue({
          fieldId: 'custbody_abj_integlog_response_body',
          value: resBody
        });

        if(isUpdate){
          sosLogRec.setValue({
            fieldId: 'custbody_abj_integlog_trx_update',
            value: linkTrx
          });
        }
  
        if(!isUpdate){
          sosLogRec.setValue({
            fieldId: 'custbody_abj_integlog_trx_number',
            value: linkTrx
          });
        }

        if(linkItem){
          sosLogRec.setValue({
            fieldId: 'custbody_sos_link_item',
            value: linkItem
          });
        }

        if(status){
          sosLogRec.setValue({
            fieldId: 'custbody_abj_integlog_status',
            value: status
          });
        }

        if(scriptId){
          sosLogRec.setValue({
            fieldId: 'custbody_abj_integlog_script_id',
            value: scriptId
          });
        }

        if(deploymentId){
          sosLogRec.setValue({
            fieldId: 'custbody_abj_integlog_deploy_script_id',
            value: deploymentId
          });
        }

        if(tranETPNumber){
          sosLogRec.setValue({
            fieldId: 'custbody_sos_tran_etp',
            value: tranETPNumber
          });
        }
  
        const recId = sosLogRec.save();
        log.debug('SOS Integration Log created with ID:', recId);
        return recId;
  
      } catch (e) {
        log.error('Error creating SOS Integration Log', e);
      }
    };
  
    return { createSOSIntegrationLog };
  
  });
  