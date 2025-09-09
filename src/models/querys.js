export const querys = {
  getInstancias: `SELECT DISTINCT InstanciaID FROM [Videoteca_dev].[dbo].BW_Asociaciones WHERE BotAR = 1`,
  getDeliveriesByInstancia: `SELECT DISTINCT DeliveryID FROM [Videoteca_dev].[dbo].BW_Asociaciones WHERE BotAR = 1 AND InstanciaID = @instancia`,
  getAlertasDelDia: `SELECT DeliveryID, NoticiaID, Titulo, TipoMedioID, NombreMedio, GrupoCli, FechaAlta, Descripcion, TipoArticulo, ConsultaID, UserID_Pagina FROM [Videoteca_dev].[dbo].BW_AlertasEmergencia WHERE DeliveryID = @delivery AND CAST(FechaAlta AS date) = CAST(GETDATE() AS date)`,
  checkAlertaEnviada: `SELECT 1 FROM [Videoteca_dev].[dbo].BW_AlertasEnviadas WHERE DeliveryID = @delivery AND NoticiaID = @noticia`,
  insertAlertaEnviada: `INSERT INTO [Videoteca_dev].[dbo].BW_AlertasEnviadas (DeliveryID, NoticiaID, FechaAlta) VALUES (@delivery, @noticia, GETDATE())`
};
