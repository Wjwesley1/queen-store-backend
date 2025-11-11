// src/index.js — QUEEN STORE IMORTAL COM DB_HOST + SSL + CLOUDFLARE TUNNEL
require('dotenv').config();
const express = require('express');
const { Client } = require('pg'); // Client = NUNCA MAIS ECONNRESET

const app = express();
app.use(express.json());

// CORS FORÇADO — CLOUDFLARE NÃO BLOQUEIA
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'https://queen-store-476215.web.app',
    'https://queen-store.web.app'
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

// CLIENTE COM DB_HOST + SSL OBRIGATÓRIO
const createClient = () => {
  return new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: {
      rejectUnauthorized: false,  // OBRIGATÓRIO PRO RAILWAY/NEON
      requestCert: true
    }
  });
};

// TESTE IMORTAL
app.get('/api/test', (req, res) => {
  res.json({ 
    status: 'QUEEN STORE IMORTAL', 
    hora: new Date().toLocaleString('pt-BR'),
    db: 'DB_HOST + SSL ATIVO',
    uptime: process.uptime().toFixed(0) + 's'
  });
});

// LISTAR PRODUTOS
app.get('/api/produtos', async (req, res) => {
  const client = createClient();
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT id, nome, preco, imagem, estoque, categoria, badge, descricao 
      FROM produtos 
      WHERE estoque > 0 
      ORDER BY id
    `);
    await client.end();
    res.json(rows);
  } catch (err) {
    console.error('ERRO PRODUTOS:', err.message);
    try { await client.end(); } catch {}
    res.status(500).json({ erro: 'Banco em manutenção (volta em 5s)' });
  }
});

// PRODUTO POR ID
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const client = createClient();
  try {
    await client.connect();
    const { rows } = await client.query('SELECT * FROM produtos WHERE id = $1 AND estoque > 0', [id]);
    await client.end();
    if (rows.length === 0) return res.status(404).json({ erro: 'Produto esgotado' });
    res.json(rows[0]);
  } catch (err) {
    try { await client.end(); } catch {}
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// ADICIONAR AO CARRINHO
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();
  const client = createClient();

  try {
    await client.connect();

    const prod = await client.query('SELECT id, nome, estoque FROM produtos WHERE id = $1', [produto_id]);
    if (prod.rows.length === 0 || prod.rows[0].estoque < 1) {
      await client.end();
      return res.status(400).json({ erro: 'Produto esgotado' });
    }

    const totalRes = await client.query(
      'SELECT COALESCE(SUM(quantidade), 0) as total FROM carrinho WHERE produto_id = $1 AND sessao = $2',
      [produto_id, sessao]
    );
    const total = parseInt(totalRes.rows[0].total) + quantidade;
    if (total > prod.rows[0].estoque) {
      await client.end();
      return res.status(400).json({ erro: 'Estoque insuficiente', disponivel: prod.rows[0].estoque });
    }

    await client.query(`
      INSERT INTO carrinho (produto_id, quantidade, sessao) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (produto_id, sessao) DO UPDATE SET quantidade = carrinho.quantidade + $2
    `, [produto_id, quantidade, sessao]);

    await client.end();
    res.json({ sucesso: true, mensagem: 'Adicionado ao carrinho!' });
  } catch (err) {
    try { await client.end(); } catch {}
    console.error('ERRO CARRINHO:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// LISTAR CARRINHO
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();
  const client = createClient();
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT c.produto_id, p.nome, p.preco, p.imagem, c.quantidade
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
      WHERE c.sessao = $1
    `, [sessao]);
    await client.end();
    res.json(rows);
  } catch (err) {
    try { await client.end(); } catch {}
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
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

// INICIA
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`QUEEN STORE IMORTAL RODANDO NA PORTA ${PORT}`);
  console.log(`TESTE: https://seasons-admissions-arctic-height.trycloudflare.com/api/test`);
});