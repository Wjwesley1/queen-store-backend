// src/index.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors({
  origin: ['http://localhost:3000', 'https://queen-store.web.app'], // Permite front-end local e Firebase
  credentials: true
}));
app.use(express.json());

// Configuração do Pool do PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',        // Cloud SQL Proxy
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: 20,                                        // Máximo de conexões
  idleTimeoutMillis: 30000,                       // Fecha conexões ociosas
  connectionTimeoutMillis: 2000,                  // Timeout de conexão
});

// Teste de conexão ao iniciar
pool.on('connect', () => {
  console.log('Conectado ao banco de dados com sucesso!');
});

pool.on('error', (err) => {
  console.error('Erro na conexão com o banco:', err.message);
});

// Endpoint: Listar todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome, preco, imagem, estoque, categoria, badge 
      FROM produtos 
      ORDER BY id
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
  }
});

// Endpoint: Buscar produto por ID (útil para página de detalhes)
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Erro ao buscar produto:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Endpoint: Adicionar ao carrinho (simulação simples)
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  try {
    // Verifica se o produto existe
    const produtoCheck = await pool.query('SELECT * FROM produtos WHERE id = $1', [produto_id]);
    if (produtoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    // Insere no carrinho (tabela carrinho deve existir)
    const { rows } = await pool.query(
      `INSERT INTO carrinho (produto_id, quantidade) 
       VALUES ($1, $2) 
       RETURNING id, produto_id, quantidade`,
      [produto_id, quantidade]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao adicionar ao carrinho:', err.message);
    res.status(500).json({ error: 'Erro ao adicionar ao carrinho' });
  }
});

// Endpoint: Listar carrinho com detalhes do produto
app.get('/api/carrinho', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.produto_id,
        p.nome,
        p.preco,
        p.imagem,
        p.categoria,
        p.badge,
        c.quantidade
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
      ORDER BY c.id
    `);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Erro ao listar carrinho:', err.message);
    res.status(500).json({ error: 'Erro ao carregar carrinho' });
  }
});

// Endpoint: Formulário de contato
app.post('/api/contato', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO contatos (email) VALUES ($1) RETURNING id, email, created_at',
      [email]
    );
    res.status(201).json({ message: 'Inscrição realizada com sucesso!', data: rows[0] });
  } catch (err) {
    console.error('Erro ao salvar contato:', err.message);
    res.status(500).json({ error: 'Erro ao processar inscrição' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Inicia o servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API da Queen Store rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/api/produtos`);
});