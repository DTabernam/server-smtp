import { NextResponse } from 'next/server';
import dns from 'dns';
import net from 'net';
import whois from 'whois-json';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email) && email.length <= 254;
};

const checkMXRecord = async (domain) => {
  try {
    const addresses = await resolveMx(domain);
    console.log(`Registros MX para el dominio: ${domain}`, addresses);
    return addresses && addresses.length > 0 ? addresses : null;
  } catch (err) {
    console.log(`Error resolviendo registros MX para el dominio: ${domain}`, err);
    return null;
  }
};

const getDomainInfo = async (domain) => {
  try {
    const domainInfo = await whois(domain);
    console.log('Información del dominio:', domainInfo);

    const creationDate = domainInfo.creationDate || domainInfo.created;
    const expirationDate = domainInfo.expirationDate || domainInfo.expires;
    const updatedDate = domainInfo.updatedDate || domainInfo.changed;
    const registrar = domainInfo.registrar;
    const nameServers = domainInfo.nameServers || domainInfo.nserver;
    const status = domainInfo.status;
    const registrantContact = domainInfo.registrantContact || domainInfo.registrant;
    const adminContact = domainInfo.adminContact || domainInfo.admin;
    const techContact = domainInfo.techContact || domainInfo.tech;

    const creationDateObj = creationDate ? new Date(creationDate) : null;
    const domainAge = creationDateObj ? calculateDomainAge(creationDateObj) : null;

    return {
      creationDate: creationDateObj,
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      updatedDate: updatedDate ? new Date(updatedDate) : null,
      registrar: registrar || null,
      nameServers: nameServers || [],
      status: status || null,
      registrantContact: registrantContact || null,
      adminContact: adminContact || null,
      techContact: techContact || null,
      domainAge: domainAge
    };
  } catch (error) {
    console.log(`Error obteniendo la información WHOIS para el dominio: ${domain}`, error);
    return null;
  }
};

const calculateDomainAge = (creationDate) => {
  const now = new Date();
  const years = now.getFullYear() - creationDate.getFullYear();
  const months = now.getMonth() - creationDate.getMonth();
  const days = now.getDate() - creationDate.getDate();

  return {
    years: months < 0 || (months === 0 && days < 0) ? years - 1 : years,
    months: (months + 12) % 12,
    days: days < 0 ? new Date(now.getFullYear(), now.getMonth(), 0).getDate() + days : days
  };
};

const verifyEmailSMTP = async (email) => {
  const domain = email.split('@')[1];
  const mxRecords = await checkMXRecord(domain);

  if (!mxRecords) {
    console.log(`No se encontraron registros MX para el dominio: ${domain}`);
    return { verified: false, mxRecord: null, domainInfo: null };
  }

  const mxRecord = mxRecords[0].exchange;

  return new Promise((resolve, reject) => {
    const client = net.createConnection(25, mxRecord);

    let stage = 0; // Indicar la etapa del protocolo SMTP

    client.setEncoding('utf8');
    client.setTimeout(10000); // Establecer un tiempo de espera para la conexión SMTP

    client.on('data', async (data) => {
      const message = data.toString();
      console.log(`Mensaje del servidor SMTP: ${message}`);

      if (stage === 0 && message.includes('220')) {
        client.write(`HELO ${domain}\r\n`);
        stage++;
      } else if (stage === 1 && message.includes('250')) {
        client.write(`VRFY ${email}\r\n`);
        stage++;
      } else if (stage === 2) {
        if (message.includes('250')) {
          const domainInfo = await getDomainInfo(domain);
          client.end();
          resolve({ verified: true, mxRecord, domainInfo });
        } else if (message.includes('550')) {
          client.end();
          resolve({ verified: false, mxRecord, domainInfo: null });
        } else {
          client.write(`MAIL FROM:<noreply@${domain}>\r\n`);
          stage++;
        }
      } else if (stage === 3 && message.includes('250')) {
        client.write(`RCPT TO:<${email}>\r\n`);
        stage++;
      } else if (stage === 4 && message.includes('250')) {
        const domainInfo = await getDomainInfo(domain);
        client.end();
        resolve({ verified: true, mxRecord, domainInfo });
      } else if (stage === 4 && message.includes('550')) {
        client.end();
        resolve({ verified: false, mxRecord, domainInfo: null });
      } else {
        client.end();
        resolve({ verified: false, mxRecord, domainInfo: null });
      }
    });

    client.on('error', (err) => {
      console.log(`Error durante la conversación SMTP: ${err}`);
      client.end();
      reject(err);
    });

    client.on('timeout', () => {
      console.log('Conexión SMTP agotada');
      client.end();
      reject(new Error('Conexión SMTP agotada'));
    });

    client.on('end', () => {
      console.log('Conexión SMTP cerrada');
    });

    client.on('close', (hadError) => {
      console.log('Conexión SMTP cerrada por el servidor', hadError ? 'debido a un error' : '');
    });
  });
};

const verifyEmails = async (emails) => {
  const results = [];
  for (const email of emails) {
    console.log(`Verificando email: ${email}`);
    if (!isValidEmail(email)) {
      results.push({ email, valid: false, message: 'Email no válido' });
      continue;
    }

    try {
      const { verified, mxRecord, domainInfo } = await verifyEmailSMTP(email);
      const message = verified 
        ? 'Email es real y puede recibir correos.'
        : 'El dominio del correo electrónico no puede recibir correos.';
      results.push({ email, valid: verified, message, mxRecord, domainInfo });
    } catch (error) {
      console.log(`Error verificando el email ${email}:`, error);
      results.push({ email, valid: false, message: 'Error al verificar el correo electrónico.' });
    }
  }
  return results;
};

export async function POST(req) {
  try {
    const { emails: emailsList } = await req.json();
    const emails = emailsList.split(',').map(email => email.trim());
    console.log('Emails recibidos del cuerpo de la solicitud:', emails);
    const results = await verifyEmails(emails);
    console.log('Resultados de la verificación:', results);

    return NextResponse.json({ results });
  } catch (error) {
    console.log('Error durante la verificación de correos electrónicos:', error);
    return NextResponse.json({ message: 'Error al verificar los correos electrónicos.' }, { status: 500 });
  }
}
