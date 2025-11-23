// src/index.js — QUEEN STORE BACKEND IMORTAL (Render + Neon + Vercel)
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); // CORRIGIDO: Pool, não Client
const app = express();

// CORS LIBERADO PRA VERCEL E LOCALHOST
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://queen-store-frontend.vercel.app',
    'https://queenstore.com.br',
    'https://www.queenstore.com.br'
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

app.use(express.json());

// POOL CORRETO COM NEON.TECH
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ROTA RAIZ
app.get('/', (req, res) => {
  res.json({ mensagem: 'Queen Store API rodando 100%!', status: 'IMORTAL' });
});

// LISTA TODOS OS PRODUTOS
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// CARRINHO - LISTAR ITENS
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'temp';
  try {
    const result = await pool.query(`
      SELECT c.*, p.nome, p.preco, p.imagem, p.estoque
      FROM carrinho c 
      JOIN produtos p ON c.produto_id = p.id 
      WHERE c.sessao = $1
    `, [sessao]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro no carrinho:', err);
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
});

// CARRINHO - ADICIONAR OU ATUALIZAR
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['x-session-id'] || 'temp';

  if (!produto_id) {
    return res.status(400).json({ erro: 'produto_id obrigatório' });
  }

  try {
    // Verifica estoque antes
    const estoqueCheck = await pool.query('SELECT estoque FROM produtos WHERE id = $1', [produto_id]);
    if (estoqueCheck.rows.length === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    if (estoqueCheck.rows[0].estoque < 1) {
      return res.status(400).json({ erro: 'Produto esgotado' });
    }

    // Adiciona/atualiza carrinho
    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id) DO UPDATE SET quantidade = EXCLUDED.quantidade
    `, [sessao, produto_id, quantidade]);

    // Reduz estoque
    if (quantidade > 0) {
      await pool.query(
        'UPDATE produtos SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0',
        [produto_id]
      );
    }

    res.json({ sucesso: true, mensagem: 'Adicionado ao carrinho!' });
  } catch (err) {
    console.error('Erro ao adicionar no carrinho:', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    hora: new Date().toLocaleString('pt-BR'),
    rainha: 'Wesley, porra!'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`QUEEN STORE API RODANDO NA PORTA ${PORT} COM CORS LIBERADO!`);
  console.log(`https://queen-store-api.onrender.com`);
});