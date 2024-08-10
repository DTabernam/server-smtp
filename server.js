const dns = require('dns');
const net = require('net');
const whois = require('whois-json');
const { promisify } = require('util');
const express = require('express');

const resolveMx = promisify(dns.resolveMx);
const app = express();
app.use(express.json());

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

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
    const creationDateObj = creationDate ? new Date(creationDate) : null;
    const domainAge = creationDateObj ? calculateDomainAge(creationDateObj) : null;

    return {
      creationDate: creationDateObj,
      expirationDate: domainInfo.expirationDate ? new Date(domainInfo.expirationDate) : null,
      updatedDate: domainInfo.updatedDate ? new Date(domainInfo.updatedDate) : null,
      registrar: domainInfo.registrar || null,
      nameServers: domainInfo.nameServers || [],
      status: domainInfo.status || null,
      domainAge,
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
    const client = net.createConnection({ host: mxRecord, port: 25 });

    let stage = 0; // Indicar la etapa del protocolo SMTP

    client.setEncoding('utf8');
    client.setTimeout(10000); // Tiempo de espera para la conexión SMTP

    client.on('data', async (data) => {
      const message = data.toString();
      console.log(`Mensaje del servidor SMTP: ${message}`);

      switch(stage) {
        case 0:
          if (message.includes('220')) {
            client.write(`HELO ${domain}\r\n`);
            stage++;
          } else {
            client.end();
            resolve({ verified: false, mxRecord, domainInfo: null });
          }
          break;
        case 1:
          if (message.includes('250')) {
            client.write(`VRFY ${email}\r\n`);
            stage++;
          } else {
            client.end();
            resolve({ verified: false, mxRecord, domainInfo: null });
          }
          break;
        case 2:
          if (message.includes('250')) {
            const domainInfo = await getDomainInfo(domain);
            client.end();
            resolve({ verified: true, mxRecord, domainInfo });
          } else if (message.includes('550')) {
            client.end();
            resolve({ verified: false, mxRecord, domainInfo: null });
          } else {
            client.end();
            resolve({ verified: false, mxRecord, domainInfo: null });
          }
          break;
        default:
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
  const results = await Promise.all(emails.map(async (email) => {
    console.log(`Verificando email: ${email}`);
    if (!isValidEmail(email)) {
      return { email, valid: false, message: 'Email no válido' };
    }

    try {
      const { verified, mxRecord, domainInfo } = await verifyEmailSMTP(email);
      return {
        email,
        valid: verified,
        message: verified ? 'Email es real y puede recibir correos.' : 'El dominio del correo electrónico no puede recibir correos.',
        mxRecord,
        domainInfo,
      };
    } catch (error) {
      console.log(`Error verificando el email ${email}:`, error);
      return { email, valid: false, message: 'Error al verificar el correo electrónico.' };
    }
  }));
  return results;
};

app.post('/verify-email', async (req, res) => {
  try {
    const { email } = req.body;
    console.log(`Verificando email: ${email}`);
    const emails = [email];
    const results = await verifyEmails(emails);
    console.log('Resultados de la verificación:', results);
    res.json(results[0]);
  } catch (error) {
    console.log('Error durante la verificación de correos electrónicos:', error);
    res.status(500).json({ message: 'Error al verificar los correos electrónicos.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de verificación SMTP escuchando en el puerto ${PORT}`);
});
