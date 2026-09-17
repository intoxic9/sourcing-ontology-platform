/** Source-system labels stamped on ingested provenance and object_source_keys. */
export const SAP_VENDOR_MASTER = 'SAP_VENDOR_MASTER' as const;
export const SAP_MATERIAL_MASTER = 'SAP_MATERIAL_MASTER' as const;
export const SAP_DEVICE_MASTER = 'SAP_DEVICE_MASTER' as const;
export const SAP_SUPPLY_REL = 'SAP_SUPPLY_REL' as const;
export const SAP_DEVICE_BOM = 'SAP_DEVICE_BOM' as const;

export type IngestSourceSystem =
  | typeof SAP_VENDOR_MASTER
  | typeof SAP_MATERIAL_MASTER
  | typeof SAP_DEVICE_MASTER
  | typeof SAP_SUPPLY_REL
  | typeof SAP_DEVICE_BOM;
