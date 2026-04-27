"use client";

import { useState } from 'react';
import axios from 'axios';

export default function Home() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCheckEmail = async () => {
    setLoading(true);
    setResult('');
    console.log(`Verificando email: ${email}`);
    try {
      const response = await axios.post('/api/verify-email', { emails: email });
      console.log('Respuesta del servidor:', response.data);
      const results = response.data.results;
      const displayResults = results.map(res => {
        const domainInfo = res.domainInfo;
        const domainAge = domainInfo ? domainInfo.domainAge : null;
        if(res.message !='El dominio del correo electrónico no puede recibir correos.'){
        return `
          Email: ${res.email}
          Estado del servidor: ${domainInfo ? domainInfo.status : 'No disponible'}
          Fecha de creación: ${domainInfo ? new Date(domainInfo.creationDate).toDateString() : 'No disponible'}
          Edad del dominio: ${domainAge ? `${domainAge.years} años, ${domainAge.months} meses, ${domainAge.days} días` : 'No disponible'}
          Servidor SMTP: ${res.mxRecord || 'No disponible'}
          Contacto técnico: ${domainInfo ? domainInfo.techContact || 'No disponible' : 'No disponible'}
          Contacto administrativo: ${domainInfo ? domainInfo.adminContact || 'No disponible' : 'No disponible'}
          Contacto del registrante: ${domainInfo ? domainInfo.registrantContact || 'No disponible' : 'No disponible'}
          Mensaje: ${res.message}

        `;}
        else{
          return `Mensaje: ${res.message}`;
        }
      }).join('\n\n');
      setResult(displayResults);
    } catch (error) {
      console.error('Error al verificar el email:', error);
      setResult('Error al verificar el email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Verificador de Email</h1>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Ingresa tu email"
        style={{ padding: '10px', width: '300px', fontSize: '16px', color: "black" }}
      />
      <button
        onClick={handleCheckEmail}
        style={{
          backgroundColor: '#343a40',
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          borderRadius: '4px',
          marginLeft: '10px'
        }}
        disabled={loading}
      >
        {loading ? 'Verificando...' : 'Verificar'}
      </button>
      {result && <pre style={{ marginTop: '20px', fontSize: '18px', whiteSpace: 'pre-wrap' }}>{result}</pre>}
    </div>
  );
}
