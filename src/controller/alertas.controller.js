import axios from 'axios';

function getTipoMedio(tipoMedioId) {
  if ([7, 8].includes(tipoMedioId)) return 'Gráfica';
  if (tipoMedioId === 10) return 'Online';
  if ([9, 11].includes(tipoMedioId)) return 'Televisión';
  if ([12, 6].includes(tipoMedioId)) return 'Radio';
  return 'Otro';
}

async function shortLink(url) {
  try {
    const res = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    return res.data.trim();
  } catch {
    return url;
  }
}

export async function enviarAlerta(client, alerta, chatId) {
  const tipoMedio = getTipoMedio(alerta.TipoMedioID);
  const lineas = [
    `*${alerta.Titulo}*`,
    alerta.Descripcion,
    `Medio: ${alerta.NombreMedio} (${tipoMedio})`
  ];
  const url = await shortLink(`https://example.com/noticia/${alerta.NoticiaID}`);
  lineas.push(url);
  const mensaje = lineas.filter(Boolean).join('\n');
  await client.sendMessage(chatId, mensaje);
}
