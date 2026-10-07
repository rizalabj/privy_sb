/**
 * @NApiVersion 2.1
 */
define(['N/query', 'N/log', 'N/error'], (query, log, error) => {
  const ITEM_SUBLIST_ID = 'item';
  const HIERARCHY_CUSTOMER_FIELD_ID = 'custbody_abj_hierarchy_customer_';
  const CUSTOMER_FIELD_ID = 'entity';

  const PRICE_LIST_RECORD_TYPE = 'customrecord_abj_privy_pricelist';

  const PRICE_LIST_FIELD_MAP = {
    customer: 'custrecord_abj_customer_master',
    hierarchyCustomer: 'custrecord_abj_cust_hierarchy',
    isTiering: 'custrecord_abj_is_tiering',
    isAccumulatedTiering: 'custrecord_abj_accumulated_tiering',
    minimumQuantity: 'custrecord_abj_price_min_qty',
    maximumQuantity: 'custrecord_abj_price_max_qty',
    startDate: 'custrecord_abj_price_agree_start_date',
    endDate: 'custrecord_abj_price_agree_end_date',
    item: 'custrecord_abj_item_price_list',
    publishedPrice: 'custrecord_abj_publised_price',
    finalPrice: 'custrecord_abj_price_final_price',
    discountOrPremium: 'custrecord_abj_price_discount_or_premium',
    isMinAchievement: 'custrecord_abj_price_is_min_achieve',
    minAchievement: 'custrecord_abj_minimum_achievement',
    billingType: 'custrecord_abj_billing_type',
    enterpriseSegment: 'cseg_abj_enterprise',
    merchantSegment: 'cseg_abj_merchant',
    applicationSegment: 'cseg_abj_applicatio',
    channelSegment: 'cseg_abj_channel_se',
    isPrepaidOrPostpaid: 'custrecord_abj_prepaid_postpaid',
    priceLevel : 'custrecord_abj_pricing',
    approvalStatus: 'custrecord_abj_pricelist_approval_status'
  };

  const PREPAID_VALUE = 13;

  const priceListTypeMap = {
    26: 'normal',
    31: 'normalWithAchievement',
    32: 'normalTiering',
    33: 'accumulatedTiering',
    34: 'bundling'
  };

  const PRICE_LIST_DRIVEN_FIELDS = [
    'quantity',
    'price',
    'rate',
    'custcol_abj_id_price_list_line',
    'custcol_abj_final_price',
    'class',
    'custcol_abj_discount_premium',
    'custcol_abj_one_time_discount',
    PRICE_LIST_FIELD_MAP.enterpriseSegment,
    PRICE_LIST_FIELD_MAP.merchantSegment,
    PRICE_LIST_FIELD_MAP.applicationSegment,
    PRICE_LIST_FIELD_MAP.channelSegment,
    'custcol_abj_so_id',
    'custcol_abj_order_line'
  ];

  const escapeSqlValue = (value) => String(value).replace(/'/g, "''");

  const formatDateForSuiteQL = (dateValue) => {
    if (!dateValue) {
      return null;
    }

    const transactionDate = new Date(dateValue);
    if (Number.isNaN(transactionDate.getTime())) {
      return null;
    }

    const year = transactionDate.getFullYear();
    const month = `${transactionDate.getMonth() + 1}`.padStart(2, '0');
    const day = `${transactionDate.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
  };

  const toNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsedValue = Number(value);
    return Number.isNaN(parsedValue) ? null : parsedValue;
  };

  const toBooleanFlag = (value) => (value === 'T' || value === true || Number(value) === 1 ? 1 : 0);

  const mapPriceListRow = (result) => ({
    privyPriceListId: result.id,
    publishedPrice: toNumberOrNull(result.published_price),
    finalPrice: toNumberOrNull(result.final_price),
    discountOrPremium: toNumberOrNull(result.discount_or_premium),
    isTiering: toBooleanFlag(result.is_tiering),
    isAccumulatedTiering: toBooleanFlag(result.is_accumulated_tiering),
    minimumQuantity: toNumberOrNull(result.minimum_quantity),
    maximumQuantity: toNumberOrNull(result.maximum_quantity),
    customform: toNumberOrNull(result.customform),
    type: priceListTypeMap[toNumberOrNull(result.customform)],
    isMinAchievement: toBooleanFlag(result.is_min_achievement),
    minimumAchievement: toNumberOrNull(result.minimum_achievement),
    billingType: result.billing_type,
    billingTypeAccount: result.billing_type_account,
    enterpriseSegment: result.enterprise_segment,
    merchantSegment: result.merchant_segment,
    applicationSegment: result.application_segment,
    channelSegment: result.channel_segment,
    isPrepaidOrPostpaid: Number(result.is_prepaid_or_postpaid),
    soOneTimeDiscountPerPcs: toNumberOrNull(result.so_one_time_discount_per_pcs),
    soId: toNumberOrNull(result.so_id),
    soLineId: toNumberOrNull(result.so_line_id),
    soTrandate: result.so_trandate,
    soQtyUsage: toNumberOrNull(result.so_qty_usage),
    soQty : Math.abs(toNumberOrNull(result.so_qty)),
    priceLevel : result.price_level,
    usedQuantity : Math.abs(result.used_quantity)
  });

  const buildPriceLookupMap = (customerId, hierarchyCustomerId, trandate, itemIds, currentTransactionId) => {
    log.debug({
      title: 'buildPriceLookupMap',
      details: { customerId, hierarchyCustomerId, trandate, itemIds }
    });

    if (!customerId || !hierarchyCustomerId || !trandate || itemIds.length === 0) {
      return {};
    }

    const escapedHierarchyCustomerId = escapeSqlValue(hierarchyCustomerId);
    const escapedCustomerId = escapeSqlValue(customerId);
    const escapedDate = escapeSqlValue(trandate);
    const itemIdList = itemIds.map((itemId) => Number(itemId)).filter((itemId) => !Number.isNaN(itemId));

    if (itemIdList.length === 0) {
      return {};
    }

    let excludeCurrentTransactionSql = '';
    let currentTrxPrepaidJoin = '';
    let currentTrxPrepaidSelect = `CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.custcol_abj_qty_usage ELSE NULL END AS so_qty_usage`;

    if (currentTransactionId) {
      const trxIdNum = Number(currentTransactionId);
      
      // 1. Exclude untuk Postpaid (Historical Usage)
      excludeCurrentTransactionSql = ` AND t.id != ${trxIdNum} `;
      
      // 2. Kalkulasi "Refund" kuota untuk Prepaid berdasarkan line SO
      currentTrxPrepaidJoin = `
        LEFT JOIN (
          SELECT
            tl.custcol_abj_order_line,
            SUM(ABS(tl.quantity)) AS current_trx_usage
          FROM transactionline tl
          WHERE tl.transaction = ${trxIdNum}
            AND tl.custcol_abj_order_line IS NOT NULL
          GROUP BY tl.custcol_abj_order_line
        ) current_prepaid_trx ON current_prepaid_trx.custcol_abj_order_line = sol.id
      `;

      // 3. Select untuk Prepaid: Kurangi usage di SO dengan usage dari transaksi ini
      currentTrxPrepaidSelect = `
        CASE 
          WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN 
            (COALESCE(sol.custcol_abj_qty_usage, 0) - COALESCE(current_prepaid_trx.current_trx_usage, 0))
          ELSE NULL 
        END AS so_qty_usage
      `;
    }

    const suiteQL = `
      SELECT
        pl.id AS id,
        pl.${PRICE_LIST_FIELD_MAP.item} AS item_id,
        pl.${PRICE_LIST_FIELD_MAP.publishedPrice} AS published_price,
        pl.${PRICE_LIST_FIELD_MAP.finalPrice} AS final_price,
        pl.${PRICE_LIST_FIELD_MAP.discountOrPremium} AS discount_or_premium,
        pl.${PRICE_LIST_FIELD_MAP.isTiering} AS is_tiering,
        pl.${PRICE_LIST_FIELD_MAP.isAccumulatedTiering} AS is_accumulated_tiering,
        pl.${PRICE_LIST_FIELD_MAP.minimumQuantity} AS minimum_quantity,
        pl.${PRICE_LIST_FIELD_MAP.maximumQuantity} AS maximum_quantity,
        '' AS customform,
        pl.${PRICE_LIST_FIELD_MAP.isMinAchievement} AS is_min_achievement,
        pl.${PRICE_LIST_FIELD_MAP.minAchievement} AS minimum_achievement,
        pl.${PRICE_LIST_FIELD_MAP.enterpriseSegment} AS enterprise_segment,
        pl.${PRICE_LIST_FIELD_MAP.merchantSegment} AS merchant_segment,
        pl.${PRICE_LIST_FIELD_MAP.applicationSegment} AS application_segment,
        pl.${PRICE_LIST_FIELD_MAP.channelSegment} AS channel_segment,
        pl.${PRICE_LIST_FIELD_MAP.billingType} AS billing_type,
        pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} AS is_prepaid_or_postpaid,
        pl.${PRICE_LIST_FIELD_MAP.priceLevel} AS price_level,
        BT.custrecord_abj_rev_rec_account AS billing_type_account,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 
          THEN 
            COALESCE(
              sol.custcol_abj_dis_onetime_pcs, 
              (sol.custcol_abj_one_time_discount / NULLIF(ABS(sol.quantity), 0))
            )
          ELSE 
            NULL 
          END 
        AS so_one_time_discount_per_pcs,
        ${currentTrxPrepaidSelect},
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.quantity ELSE NULL END AS so_qty,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.transaction ELSE NULL END AS so_id,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.so_trandate ELSE NULL END AS so_trandate,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.id ELSE NULL END AS so_line_id,
        CASE 
          WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 12 AND pl.${PRICE_LIST_FIELD_MAP.isTiering} = 'T'
          THEN 
            COALESCE(usage_trx.total_usage_qty, 0) 
          ELSE 
            NULL 
        END AS used_quantity
      FROM
        ${PRICE_LIST_RECORD_TYPE} pl
        JOIN classification BT ON BT.id = pl.${PRICE_LIST_FIELD_MAP.billingType}
        LEFT JOIN (
          SELECT
            tl.*,
            t.type AS so_type,
            t.trandate AS so_trandate
          FROM transactionline tl
          JOIN transaction t ON t.id = tl.transaction
          WHERE t.type = 'SalesOrd' 
            OR (t.type = 'CustInvc' AND tl.createdFrom IS NULL AND t.customForm = 187)
        ) sol
          ON sol.item = pl.${PRICE_LIST_FIELD_MAP.item}
          AND sol.custcol_abj_id_price_list_line = pl.id
          AND sol.custcol_abj_privy_customer_hierarchy_ = pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer}
          AND pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13
          AND TO_DATE('${escapedDate}', 'YYYY-MM-DD')
            BETWEEN sol.custcol_abj_billing_start_date
            AND sol.custcol_abj_billing_end_date
        ${currentTrxPrepaidJoin}
        LEFT JOIN (
          SELECT 
            tl.item,
            tl.custcol_abj_id_price_list_line,
            tl.custcol_abj_privy_customer_hierarchy_,
            SUM(tl.quantity) AS total_usage_qty 
          FROM 
            transactionline tl 
            JOIN transaction t ON t.id = tl.transaction 
          WHERE 
            t.type = 'CuTrSale'
            AND recordType = 'customsale_abj_usage_pre_postpaid'
            ${excludeCurrentTransactionSql}
          GROUP BY
            tl.item,
            tl.custcol_abj_id_price_list_line,
            tl.custcol_abj_privy_customer_hierarchy_
        ) usage_trx ON usage_trx.item = pl.custrecord_abj_item_price_list 
        AND usage_trx.custcol_abj_id_price_list_line = pl.id 
        AND usage_trx.custcol_abj_privy_customer_hierarchy_ = pl.custrecord_abj_cust_hierarchy
        AND pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 12
      WHERE
        pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer} = '${escapedHierarchyCustomerId}'
        AND pl.${PRICE_LIST_FIELD_MAP.customer} = '${escapedCustomerId}'
        AND pl.isinactive = 'F'
        AND pl.custrecord_abj_is_usage = 'T'
        AND (
          pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 12 AND pl.${PRICE_LIST_FIELD_MAP.approvalStatus} = 2
          OR
          pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} != 12
        )
        AND TO_DATE('${escapedDate}', 'YYYY-MM-DD')
          BETWEEN pl.${PRICE_LIST_FIELD_MAP.startDate}
          AND pl.${PRICE_LIST_FIELD_MAP.endDate}
        AND pl.${PRICE_LIST_FIELD_MAP.item} IN (${itemIdList.join(', ')})
      ORDER BY
        sol.so_trandate ASC NULLS LAST,
        sol.transaction ASC NULLS LAST
    `;

    log.debug({ title: 'Price List Query', details: suiteQL });

    const resultSet = query.runSuiteQL({ query: suiteQL });
    const mappedResults = resultSet.asMappedResults();

    log.debug('mappedResults', mappedResults);

    const bucketMapsByItem = {};
    
    mappedResults.forEach((result) => {
      const itemId = String(result.item_id);
      
      const bucketId = (result.so_id && result.so_line_id) 
          ? 'SO_' + result.so_id + '_LINE_' + result.so_line_id 
          : 'PL_' + result.id;

      if (!bucketMapsByItem[itemId]) {
        bucketMapsByItem[itemId] = new Map();
      }

      bucketMapsByItem[itemId].set(bucketId, mapPriceListRow(result));
    });

    const priceLookupMap = {};
    Object.keys(bucketMapsByItem).forEach((itemId) => {
      priceLookupMap[itemId] = Array.from(bucketMapsByItem[itemId].values());
    });

    return priceLookupMap;
  };

  // ---------------------------------------------------------------------
  // Pricing resolution: normal / min-achievement / tiering / accumulated
  // ---------------------------------------------------------------------

  const resolveAccumulatedTiering = (tiers, quantity) => {
    log.debug('resolveAccumulatedTiering', { tiers , quantity});
    const sortedTiers = [...tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);

    let remainingQuantity = quantity;
    const allocations = []; // FIX: return array of { matchedPrice, quantity }

    for (const tier of sortedTiers) {
      if (remainingQuantity <= 0) break;

      const tierLowerBound = tier.minimumQuantity === 0 ? 0 : tier.minimumQuantity - 1;
      const tierUpperBound = tier.maximumQuantity ?? Infinity;
      const tierCapacity = tierUpperBound - tierLowerBound;

      const usedQtyInThisTier = Math.abs(tier.usedQuantity || 0);
      const availableCapacityInTier = Math.max(0, tierCapacity - usedQtyInThisTier);

      if (availableCapacityInTier <= 0) continue;

      const qtyInTier = Math.min(remainingQuantity, availableCapacityInTier);

      if (qtyInTier > 0) {
        allocations.push({
          matchedPrice: tier, 
          quantity: qtyInTier
        });
        remainingQuantity -= qtyInTier;
      }
    }

    log.debug('accumulated allocations', allocations);
    return allocations;
  };

  const resolveMatchedPrices = (priceListEntries, quantity) => {
    let matchedPrices = priceListEntries;

    if (matchedPrices.length === 0) return [];
    
    // FIX: Kembalikan format seragam yaitu Array of Allocations: [{ matchedPrice, quantity }]
    if (matchedPrices.length === 1 && matchedPrices[0].isAccumulatedTiering !== 1) {
      return [{ matchedPrice: matchedPrices[0], quantity }];
    }

    const minAchievementPrice = matchedPrices.find(
      (price) => price.isMinAchievement === 1 && price.minimumAchievement !== null && quantity >= price.minimumAchievement
    );
    if (minAchievementPrice) {
      return [{ matchedPrice: minAchievementPrice, quantity }];
    }

    // tiering normal
    const tieredPrice = matchedPrices.find(
      (price) => {
        if (
          price.isTiering === 1 && 
          price.isAccumulatedTiering !== 1 && 
          price.minimumQuantity !== null
        ) {
          const usedQty = Math.abs(price.usedQuantity || 0);
          const totalVolume = usedQty + quantity;
          
          const maxQty = price.maximumQuantity ?? Infinity;
          
          return totalVolume >= price.minimumQuantity && totalVolume <= maxQty;
        }
        return false;
      }
    );

    if (tieredPrice) {
      return [{ matchedPrice: tieredPrice, quantity }];
    }

    // FIX: Tidak boleh difilter pakai `quantity >= price.minimumQuantity` karena fungsi resolveAccumulatedTiering yang akan menentukan batasnya berdasarkan `usedQuantity`
    const accumulatedTiers = matchedPrices.filter(
      (price) => price.isTiering === 1 && price.isAccumulatedTiering === 1
    );
    if (accumulatedTiers.length > 0) {
      // Langsung me-return hasil allocations dari accumulated tiers
      return resolveAccumulatedTiering(accumulatedTiers, quantity);
    }

    return [{ matchedPrice: matchedPrices[0], quantity }];
  };

  const resolvePrepaidAllocations = (prepaidBuckets, quantity) => {
    let remainingToAllocate = quantity;
    const allocations = [];

    for (const bucket of prepaidBuckets) {
      if (remainingToAllocate <= 0) {
        break;
      }

      if (bucket.soQty === null) {
        continue; 
      }

      const bucketUsed = bucket.soQtyUsage || 0;
      const bucketRemaining = Math.max(0, bucket.soQty - bucketUsed);

      if (bucketRemaining <= 0) {
        continue; 
      }

      const qtyFromBucket = Math.min(bucketRemaining, remainingToAllocate);
      allocations.push({ matchedPrice: bucket, quantity: qtyFromBucket });
      remainingToAllocate -= qtyFromBucket;
    }

    return { allocations, shortfall: remainingToAllocate };
  };

  const captureLineSnapshot = (transactionRecord, sublistId, line) => {
    let fieldIds = [];
    try {
      fieldIds = transactionRecord.getSublistFields({ sublistId });
    } catch (e) {
      fieldIds = ['item', 'description', 'location', 'department', 'units'];
    }

    // Tambahkan field internal NetSuite yang DILARANG keras untuk disalin ke baris baru
    const SYSTEM_FIELDS_TO_IGNORE = [
      'line', 
      'lineuniquekey', 
      'sys_id', 
      'id', 
      'amount',
      'grossamt',
      'taxamount',
      'tax1amt',
      'cleared',
      'matchbilltoreceipt'
    ];

    const snapshot = {};
    fieldIds.forEach((fieldId) => {
      // Lewati field bawaan price list ATAU field internal/system
      if (PRICE_LIST_DRIVEN_FIELDS.includes(fieldId) || SYSTEM_FIELDS_TO_IGNORE.includes(fieldId)) {
        return; 
      }
      try {
        const value = transactionRecord.getSublistValue({ sublistId, fieldId, line });
        if (value !== null && value !== undefined && value !== '') {
          snapshot[fieldId] = value;
        }
      } catch (e) {
        // Abaikan jika error saat mengambil getSublistValue
      }
    });

    return snapshot;
  };

  const applyLineSnapshot = (transactionRecord, sublistId, line, snapshot) => {
    Object.keys(snapshot).forEach((fieldId) => {
      try {
        transactionRecord.setSublistValue({ sublistId, fieldId, line, value: snapshot[fieldId] });
      } catch (e) {
      }
    });
  };

  const applyPriceListValuesToLine = (transactionRecord, line, matchedPrice, allocatedQuantity) => {
    transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'quantity', line, value: allocatedQuantity });
    if(matchedPrice.priceLevel !== null && matchedPrice.priceLevel !== undefined){
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'price', line, value: matchedPrice.priceLevel });
    }

    if (matchedPrice.privyPriceListId !== null && matchedPrice.privyPriceListId !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_id_price_list_line',
        line,
        value: matchedPrice.privyPriceListId
      });
    }
    if (matchedPrice.publishedPrice !== null && matchedPrice.publishedPrice !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'rate', line, value: matchedPrice.publishedPrice });
      transactionRecord.setSublistValue({ 
        sublistId: ITEM_SUBLIST_ID, 
        fieldId: 'custcol_abj_total_published_price', 
        line, 
        value: Number(matchedPrice.publishedPrice) * Number(allocatedQuantity)
      });
    }
    if (matchedPrice.finalPrice !== null && matchedPrice.finalPrice !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_final_price',
        line,
        value: matchedPrice.finalPrice
      });
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_total_final_price',
        line,
        value: Number(matchedPrice.finalPrice) * Number(allocatedQuantity)
      });
    }
    if (matchedPrice.billingType !== null && matchedPrice.billingType !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'class', line, value: matchedPrice.billingType });
    }
    if (matchedPrice.discountOrPremium !== null && matchedPrice.discountOrPremium !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_discount_premium',
        line,
        value: matchedPrice.discountOrPremium
      });
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_total_discount_premium',
        line,
        value: Number(matchedPrice.discountOrPremium) * Number(allocatedQuantity)
      });
    }
    if (matchedPrice.soOneTimeDiscountPerPcs) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_dis_onetime_pcs',
        line,
        value: Math.abs(Number(matchedPrice.soOneTimeDiscountPerPcs))
      });
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_one_time_discount',
        line,
        value: Math.abs(Number(matchedPrice.soOneTimeDiscountPerPcs)) * Number(allocatedQuantity)
      });
    }
    if (matchedPrice.enterpriseSegment !== null && matchedPrice.enterpriseSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.enterpriseSegment,
        line,
        value: matchedPrice.enterpriseSegment
      });
    }
    if (matchedPrice.merchantSegment !== null && matchedPrice.merchantSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.merchantSegment,
        line,
        value: matchedPrice.merchantSegment
      });
    }
    if (matchedPrice.applicationSegment !== null && matchedPrice.applicationSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.applicationSegment,
        line,
        value: matchedPrice.applicationSegment
      });
    }
    if (matchedPrice.channelSegment !== null && matchedPrice.channelSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.channelSegment,
        line,
        value: matchedPrice.channelSegment
      });
    }
    if (matchedPrice.soId !== null && matchedPrice.soId !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'custcol_abj_so_id', line, value: matchedPrice.soId });
    }
    if (matchedPrice.soLineId !== null && matchedPrice.soLineId !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_order_line',
        line,
        value: matchedPrice.soLineId
      });
    }
    if (matchedPrice.isPrepaidOrPostpaid !== null && matchedPrice.isPrepaidOrPostpaid !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'cseg_abj_billing_ty',
        line,
        value: matchedPrice.isPrepaidOrPostpaid
      });
      transactionRecord.setValue({
        fieldId : 'cseg_abj_billing_ty',
        value : matchedPrice.isPrepaidOrPostpaid
      })
    }
  };

  const applyPriceListToTransaction = ({ transactionRecord }) => {
    try {
      log.debug({ title: 'applyPriceListToTransaction', details: transactionRecord });

      if (!transactionRecord) return;

      // Ambil ID transaksi yang sedang diedit (akan kosong/undefined jika ini mode Create)
      const currentTransactionId = transactionRecord.id;

      const customerId = transactionRecord.getValue({ fieldId: CUSTOMER_FIELD_ID });
      const hierarchyCustomerId = transactionRecord.getValue({ fieldId: HIERARCHY_CUSTOMER_FIELD_ID });
      const trandateValue = transactionRecord.getValue({ fieldId: 'trandate' });
      log.debug('trandateValue',trandateValue);
      const formattedTranDate = formatDateForSuiteQL(trandateValue);

      if (!customerId || !hierarchyCustomerId || !formattedTranDate) {
        return;
      }

      const lineCount = transactionRecord.getLineCount({ sublistId: ITEM_SUBLIST_ID });

      if (lineCount === 0) {
        return;
      }

      const itemIds = [];
      for (let line = 0; line < lineCount; line += 1) {
        const itemId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'item', line });
        if (itemId) {
          itemIds.push(itemId);
        }
      }

      const uniqueItemIds = [...new Set(itemIds.map((itemId) => String(itemId)))];
      const priceLookupMap = buildPriceLookupMap(customerId, hierarchyCustomerId, formattedTranDate, uniqueItemIds, currentTransactionId);

      log.debug({ title: 'Price Lookup Map', details: priceLookupMap });

      if (!priceLookupMap || Object.keys(priceLookupMap).length === 0) {
          throw error.create({
              name: 'PRICE_LIST_NOT_FOUND',
              message: 'Transaksi gagal: Pricelist tidak ditemukan sama sekali untuk item-item pada transaksi ini.',
              notifyOff: true
          });
      }

      let billingTypeAccount = null;
      let billingType = null;

      Object.keys(priceLookupMap).forEach((itemKey) => {
        priceLookupMap[itemKey].forEach((price) => {
          if (billingTypeAccount && billingTypeAccount !== price.billingTypeAccount) {
            throw error.create({
              name: 'PRICE_LIST_ACCOUNT_MISMATCH',
              message:
                'Transaksi gagal: Item yang dipilih memiliki tujuan Akun yang berbeda. Silakan pisahkan ke dalam transaksi terpisah.',
              notifyOff: true
            });
          }
          billingTypeAccount = price.billingTypeAccount;
          billingType = price.billingType;
        });
      });

      // transactionRecord.setValue({ fieldId: 'account', value: billingTypeAccount });
      transactionRecord.setValue({ fieldId: 'class', value: billingType });

      const linePlans = [];
      const warningMessages = [];

      for (let line = 0; line < lineCount; line += 1) {
        const itemId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'item', line });
        const quantity = Number(transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'quantity', line })) || 0;

        if (!itemId) {
          continue;
        }

        const priceListEntries = priceLookupMap[String(itemId)];
        if (!priceListEntries || priceListEntries.length === 0) {
          continue;
        }

        const prepaidEntries = priceListEntries.filter((entry) => entry.isPrepaidOrPostpaid === PREPAID_VALUE);
        log.debug('prepaidEntries', prepaidEntries);
        let allocations;

        if (prepaidEntries.length > 0) {
          const { allocations: prepaidAllocations, shortfall } = resolvePrepaidAllocations(prepaidEntries, quantity);

          if (shortfall === quantity) {
            // KONDISI 2: Kuota sudah terpakai semua (0) atau tidak memenuhi sama sekali -> ERROR
            throw error.create({
              name: 'PRICE_LIST_PREPAID_QUOTA_EXHAUSTED',
              message: `Transaksi gagal: Kuota prepaid untuk item ${itemId} (baris ${line + 1}) sudah habis/tidak mencukupi.`,
              notifyOff: true
            });
          } else if (shortfall > 0) {
            // KONDISI 3: Kuota terpakai sebagian, sisanya gagal -> LANJUT, TAPI CATAT WARNING
            warningMessages.push(`Baris ${line + 1} (Item ${itemId}): Request Qty ${quantity}, Teralokasi ${quantity - shortfall}, Gagal/Kurang ${shortfall}.`);
          }

          allocations = prepaidAllocations;
        } else {
          // FIX: Ambil seluruh hasil array allocations dari fungsi matchedPrices
          allocations = resolveMatchedPrices(priceListEntries, quantity);
          if (!allocations || allocations.length === 0) {
             throw error.create({
                name: 'PRICE_LIST_ALLOCATION_FAILED',
                message: `Transaksi gagal: Alokasi harga tidak ditemukan untuk item ${itemId} (baris ${line + 1}).`,
                notifyOff: true
            });
          }
        }

        linePlans.push({ line, allocations });
      }

      log.debug('line plans', linePlans);

      if (warningMessages.length > 0) {
          log.audit('Pricelist Partial Fulfillment', warningMessages.join(' | '));
          
          // CONTOH: Simpan ke custom field (Pastikan ID field ini valid di NetSuite Anda)
          // transactionRecord.setValue({ fieldId: 'custbody_pricelist_warnings', value: warningMessages.join('\n') });
          
          // CONTOH ALTERNATIF: Gabungkan ke memo
          const currentMemo = transactionRecord.getValue({ fieldId: 'memo' }) || '';
          const warningText = '[INFO PARSIAL QTY]\n' + warningMessages.join('\n');
          transactionRecord.setValue({ fieldId: 'memo', value: currentMemo ? currentMemo + '\n\n' + warningText : warningText });
      }
      

      for (let i = linePlans.length - 1; i >= 0; i -= 1) {
        const { line, allocations } = linePlans[i];

        if (allocations.length === 1) {
          applyPriceListValuesToLine(transactionRecord, line, allocations[0].matchedPrice, allocations[0].quantity);
          continue;
        }

        const snapshot = captureLineSnapshot(transactionRecord, ITEM_SUBLIST_ID, line);
        log.debug('snapshot', snapshot);

        applyPriceListValuesToLine(transactionRecord, line, allocations[0].matchedPrice, allocations[0].quantity);
        log.debug('applyPriceListValuesToLine 1', 'applyPriceListValuesToLine 1');
        for (let allocationIndex = 1; allocationIndex < allocations.length; allocationIndex += 1) {
          const insertAt = line + allocationIndex;
          transactionRecord.insertLine({ sublistId: ITEM_SUBLIST_ID, line: insertAt });
          applyLineSnapshot(transactionRecord, ITEM_SUBLIST_ID, insertAt, snapshot);
          
          applyPriceListValuesToLine(
            transactionRecord,
            insertAt,
            allocations[allocationIndex].matchedPrice,
            allocations[allocationIndex].quantity
          );
        }
      }

      return { success: true, warnings: warningMessages };
      
    } catch (err) {
      log.error('error applyPriceListToTransaction', err);

      // Pastikan custom error dilempar kembali agar menggagalkan submit dan me-return HTTP 400 di RESTlet
      const handledErrors = [
          'PRICE_LIST_ACCOUNT_MISMATCH', 
          'PRICE_LIST_NOT_FOUND', 
          'PRICE_LIST_PREPAID_QUOTA_EXHAUSTED',
          'PRICE_LIST_ALLOCATION_FAILED'
      ];

      if (err && handledErrors.includes(err.name)) {
        throw err;
      }
      throw err; // Lempar error generic lainnya
    }
  };

  return {
    applyPriceListToTransaction
  };
});