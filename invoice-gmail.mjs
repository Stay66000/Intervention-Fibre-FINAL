function bytesToBase64(bytes){
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
const base64Text=text=>bytesToBase64(new TextEncoder().encode(text));
export function validEmail(value){
  return typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}
export function buildGmailMessage({from,to,subject,body,pdfBytes,filename,boundary}){
  if(!validEmail(from)||!validEmail(to))throw new Error('Vérifie les adresses e-mail.');
  if(!subject.trim()||/[\r\n]/.test(subject))throw new Error('Indique un objet valide.');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(boundary))throw new Error('Identifiant du message invalide.');
  const safeFilename=String(filename).replace(/[^A-Za-z0-9._-]/g,'-');
  const pdf=bytesToBase64(new Uint8Array(pdfBytes)).match(/.{1,76}/g)?.join('\r\n')||'';
  const message=[`From: ${from}`,`To: ${to}`,`Subject: =?UTF-8?B?${base64Text(subject)}?=`,
    'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',
    `--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',
    base64Text(body).match(/.{1,76}/g)?.join('\r\n')||'',`--${boundary}`,
    'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${safeFilename}"`,
    'Content-Transfer-Encoding: base64','',pdf,`--${boundary}--`,''].join('\r\n');
  return base64Text(message).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
