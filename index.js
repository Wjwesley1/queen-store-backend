// src/index.js
require('dotenv').config();
const express = require('express');
const { Client } = require('pg'); 

const app = express();
app.use(express.json());

// CORS CONFIGURATION
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'https://queen-store-frontend.vercel.app/'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const pool = new pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    requestCert: true
  }
});

// LISTA PRODUTOS
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao carregar produtos' });
  }
});

// CARRINHO - LISTAR
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'temp';
  try {
    const result = await pool.query(`
      SELECT c.*, p.nome, p.preco, p.imagem 
      FROM carrinho c 
      JOIN produtos p ON c.produto_id = p.id 
      WHERE c.sessao = $1
    `, [sessao]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro no carrinho' });
  }
});

// CARRINHO - ADICIONAR/ATUALIZAR
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['x-session-id'] || 'temp';

  try {
    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id) DO UPDATE SET quantidade = EXCLUDED.quantidade
    `, [sessao, produto_id, quantidade]);

    // Atualiza estoque
    if (quantidade > 0) {
      await pool.query('UPDATE produtos SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0', [produto_id]);
    }

    res.json({ sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao adicionar' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Queen Store API rodando na porta ${PORT} com CORS liberado!`);
});

// CONTATO
app.post('/api/contato', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ erro: 'Email inválido' });
  const client = createClient();
  try {
    await client.connect();
    await client.query('INSERT INTO contatos (email) VALUES ($1)', [email]);
    await client.end();
    res.json({ mensagem: 'Inscrito com sucesso!' });
  } catch (err) {
    try { await client.end(); } catch {}
    res.status(500).json({ erro: 'Erro ao salvar' });
  }
});

// HEALTH
app.get('/health', (req, res) => {
  res.json({ status: 'OK', hora: new Date().toLocaleString('pt-BR') });
});
