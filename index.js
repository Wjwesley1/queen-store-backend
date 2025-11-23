// src/index.js — QUEEN STORE BACKEND 100% FUNCIONAL (Render + Neon + Vercel)
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const app = express();

// CORS LIBERADO
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

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// POOL DO NEON
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// RAIZ
app.get('/', (req, res) => {
  res.json({ mensagem: 'Queen Store API IMORTAL', status: '100% NO AR' });
});

// LISTA PRODUTOS
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro produtos:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// CARRINHO - LISTAR
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'temp';
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.produto_id, c.quantidade,
        p.nome, p.preco, p.imagem, p.estoque as estoque_atual
      FROM carrinho c 
      JOIN produtos p ON c.produto_id = p.id 
      WHERE c.sessao = $1
      ORDER BY c.id
    `, [sessao]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro carrinho GET:', err);
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
});

// CARRINHO - ADICIONAR
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['x-session-id'] || 'temp';

  if (!produto_id || isNaN(produto_id)) {
    return res.status(400).json({ erro: 'produto_id inválido' });
  }

  const produtoId = parseInt(produto_id);
  const qtd = parseInt(quantidade);

  if (qtd < 1) {
    return res.status(400).json({ erro: 'Quantidade inválida' });
  }

  try {
    const check = await pool.query('SELECT estoque, nome FROM produtos WHERE id = $1 FOR UPDATE', [produtoId]);
    if (check.rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });

    const produto = check.rows[0];
    if (produto.estoque < qtd) {
      return res.status(400).json({ erro: 'Estoque insuficiente', disponivel: produto.estoque });
    }

    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id) 
      DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade
    `, [sessao, produtoId, qtd]);

    await pool.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [qtd, produtoId]);

    res.json({ 
      sucesso: true, 
      mensagem: `\( {qtd} \){produto.nome} adicionado(s)!` 
    });
  } catch (err) {
    console.error('Erro POST carrinho:', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

// REMOVE DO CARRINHO — ROTA CORRETA
app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const { produto_id } = req.params;
  const sessao = req.headers['x-session-id'] || 'temp';

  try {
    const item = await pool.query(
      'SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessao, produto_id]
    );

    if (item.rows.length === 0) {
      return res.status(404).json({ erro: 'Item não encontrado' });
    }

    const qtd = item.rows[0].quantidade;

    await pool.query(
      'DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessao, produto_id]
    );

    await pool.query(
      'UPDATE produtos SET estoque = estoque + $1 WHERE id = $2',
      [qtd, produto_id]
    );

    res.json({ sucesso: true, mensagem: 'Removido com sucesso!' });
  } catch (err) {
    console.error('Erro DELETE carrinho:', err);
    res.status(500).json({ erro: 'Erro ao remover' });
  }
});


// HEALTH
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`QUEEN STORE API RODANDO NA PORTA ${PORT}`);
  console.log(`https://queen-store-api.onrender.com`);
});