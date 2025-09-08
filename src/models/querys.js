export const querys = {
    getAllAlerts: `SELECT TOP (1) * FROM [Videoteca_dev].[dbo].[BW_AlertasEmergencia]
where deliveryid = 6313 and noticiaid in (56053223,
56055114,
11180617,
11180770)
  order by fechaalta desc
`,


};

