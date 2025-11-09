// src/index.js — BACKEND COM ESTOQUE REAL + SEGURANÇA TOTAL
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors({
  origin: ['http://localhost:3000', 'https://queen-store.web.app'],
  credentials: true
}));
app.use(express.json());

// Banco de dados
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => console.log('Conectado ao banco!'));
pool.on('error', (err) => console.error('Erro no banco:', err));

// ========================================
// 1. LISTAR PRODUTOS (SÓ COM ESTOQUE > 0)
// ========================================
app.get('/api/produtos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome, preco, imagem, estoque, categoria, badge, descricao
      FROM produtos 
      WHERE estoque > 0
      ORDER BY id
    `);
    res.json(rows);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ========================================
// 2. DETALHES DO PRODUTO
// ========================================
app.get('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT * FROM produtos WHERE id = $1 AND estoque > 0
    `, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado ou esgotado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ========================================
// 3. ADICIONAR AO CARRINHO COM CONTROLE DE ESTOQUE
// ========================================
app.post('/api/carrinho', async (req, res) => {
  const { produto_id } = req.body;
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();

  try {
    // 1. Busca produto com estoque
    const produtoRes = await pool.query(
      'SELECT id, nome, estoque FROM produtos WHERE id = $1 AND estoque > 0 FOR UPDATE',
      [produto_id]
    );

    if (produtoRes.rows.length === 0) {
      return res.status(400).json({ error: 'Produto esgotado ou não existe' });
    }

    const produto = produtoRes.rows[0];

    // 2. Conta quantos já tem no carrinho desta sessão
    const carrinhoRes = await pool.query(
      'SELECT COALESCE(SUM(quantidade), 0) as total FROM carrinho WHERE produto_id = $1 AND sessao = $2',
      [produto_id, sessao]
    );

    const jaNoCarrinho = parseInt(carrinhoRes.rows[0].total);

    if (jaNoCarrinho + 1 > produto.estoque) {
      return res.status(400).json({ 
        error: 'Estoque insuficiente', 
        disponivel: produto.estoque,
        noCarrinho: jaNoCarrinho
      });
    }

    // 3. Adiciona ou atualiza carrinho
    await pool.query(`
      INSERT INTO carrinho (produto_id, quantidade, sessao) 
      VALUES ($1, 1, $2) 
      ON CONFLICT (produto_id, sessao) 
      DO UPDATE SET quantidade = carrinho.quantidade + 1
    `, [produto_id, sessao]);

    res.json({ sucesso: true, mensagem: `${produto.nome} adicionado!` });
  } catch (err) {
    console.error('Erro no carrinho:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ========================================
// 4. LISTAR CARRINHO
// ========================================
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.produto_id,
        p.nome,
        p.preco,
        p.imagem,
        c.quantidade,
        (p.preco * c.quantidade) as subtotal
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
      WHERE c.sessao = $1
    `, [sessao]);

    const total = rows.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
    res.json({ itens: rows, total: total.toFixed(2) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar carrinho' });
  }
});

// ========================================
// 5. REMOVER DO CARRINHO
// ========================================
app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const { produto_id } = req.params;
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();

  try {
    await pool.query(
      'DELETE FROM carrinho WHERE produto_id = $1 AND sessao = $2',
      [produto_id, sessao]
    );
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover' });
  }
});

// ========================================
// 6. ATUALIZAR QUANTIDADE
// ========================================
app.put('/api/carrinho/:produto_id', async (req, res) => {
  const { produto_id } = req.params;
  const { quantidade } = req.body;
  const sessao = req.headers['x-session-id'] || 'web_' + Date.now();

  if (quantidade < 1) {
    return res.status(400).json({ error: 'Quantidade inválida' });
  }

  try {
    const produto = await pool.query('SELECT estoque FROM produtos WHERE id = $1', [produto_id]);
    if (quantidade > produto.rows[0].estoque) {
      return res.status(400).json({ error: 'Estoque insuficiente' });
    }

    await pool.query(
      'UPDATE carrinho SET quantidade = $1 WHERE produto_id = $2 AND sessao = $3',
      [quantidade, produto_id, sessao]
    );
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// ========================================
// CONTATO E HEALTH
// ========================================
app.post('/api/contato', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  try {
    await pool.query('INSERT INTO contatos (email) VALUES ($1)', [email]);
    res.json({ mensagem: 'Inscrito com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'Queen Store RODANDO FORTE!', hora: new Date().toLocaleString('pt-BR') });
});

// ========================================
// INICIA SERVIDOR
// ========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`QUEEN STORE API RODANDO NA PORTA ${PORT}`);
  console.log(`PRODUTOS → http://localhost:${PORT}/api/produtos`);
});