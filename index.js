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

// CARRINHO - LISTAR ITENS (PERFEITA)
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['x-session-id'] || 'temp';
  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.sessao,
        c.produto_id,
        c.quantidade,
        p.nome,
        p.preco,
        p.imagem,
        p.estoque as estoque_atual
      FROM carrinho c 
      JOIN produtos p ON c.produto_id = p.id 
      WHERE c.sessao = $1
      ORDER BY c.id
    `, [sessao]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar carrinho:', err);
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
});

// CARRINHO - ADICIONAR OU ATUALIZAR (IMORTAL AGORA)
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['x-session-id'] || 'temp';

  if (!produto_id || isNaN(produto_id)) {
    return res.status(400).json({ erro: 'produto_id inválido' });
  }

  const produtoId = parseInt(produto_id);
  const qtd = parseInt(quantidade);

  if (qtd < 1) {
    return res.status(400).json({ erro: 'Quantidade deve ser maior que 0' });
  }

  try {
    // 1. Verifica se o produto existe e tem estoque
    const prodCheck = await pool.query(
      'SELECT estoque, nome FROM produtos WHERE id = $1 FOR UPDATE', 
      [produtoId]
    );

    if (prodCheck.rows.length === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    const produto = prodCheck.rows[0];

    if (produto.estoque < qtd) {
      return res.status(400).json({ 
        erro: 'Estoque insuficiente', 
        disponivel: produto.estoque 
      });
    }

    // 2. Adiciona ou atualiza no carrinho
    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id) 
      DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade
    `, [sessao, produtoId, qtd]);

    // 3. Reduz o estoque
    await pool.query(
      'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2',
      [qtd, produtoId]
    );

    res.json({ 
      sucesso: true, 
      mensagem: `\( {qtd > 1 ? qtd : '1'} \){produto.nome} adicionado(s) ao carrinho!` 
    });

  } catch (err) {
    console.error('Erro ao adicionar no carrinho:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// REMOVE ITEM DO CARRINHO
app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const { produto_id } = req.params;
  const sessao = req.headers['x-session-id'] || 'temp';

  try {
    // Pega a quantidade que tava no carrinho antes de deletar
    const item = await pool.query(
      'SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessao, produto_id]
    );

    if (item.rows.length === 0) {
      return res.status(404).json({ erro: 'Item não encontrado no carrinho' });
    }

    const quantidadeRemovida = item.rows[0].quantidade;

    // Remove do carrinho
    await pool.query(
      'DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessao, produto_id]
    );

    // Devolve o estoque
    await pool.query(
      'UPDATE produtos SET estoque = estoque + $1 WHERE id = $2',
      [quantidadeRemovida, produto_id]
    );

    res.json({ sucesso: true, mensagem: 'Removido do carrinho!' });
  } catch (err) {
    console.error('Erro ao remover do carrinho:', err);
    res.status(500).json({ erro: 'Erro ao remover' });
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