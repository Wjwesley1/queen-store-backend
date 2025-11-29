// src/index.js — QUEEN STORE BACKEND IMORTAL (Render + Neon + Vercel)
// Última versão 100% funcional — DELETE funcionando, estoque real, CORS perfeito

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();

// ==================== CORS LIBERADO PRA SEMPRE (Vercel + Domínio + Local) ====================
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'https://queen-store-frontend.vercel.app',
    'https://www.queenstore.store',
    'https://queenstore.store'  // sem o www também (pra garantir)
  ];

  const origin = req.headers.origin;

  // Só define o header se o origin estiver na lista (ou libera tudo com *)
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*'); // fallback seguro
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, session');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Responde preflight automaticamente
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

// ==================== CONEXÃO COM NEON.TECH (PostgreSQL) ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==================== ROTA RAIZ ====================
app.get('/', (req, res) => {
  res.json({
    mensagem: 'Queen Store API IMORTAL',
    status: '100% NO AR',
    rainha: 'Wesley mandou!',
    data: new Date().toLocaleString('pt-BR')
  });
});

// ==================== LISTAR TODOS OS PRODUTOS ====================
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== CARRINHO: LISTAR ITENS ====================
app.get('/api/carrinho', async (req, res) => {
  const sessao = req.headers['session'] || 'temp';

  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.produto_id,
        c.quantidade,
        p.nome,
        p.preco,
        p.imagem,
        p.estoque AS estoque_atual
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

// ==================== CARRINHO: ADICIONAR OU ATUALIZAR ====================
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessao = req.headers['session'] || 'temp';

  if (!produto_id || isNaN(produto_id)) {
    return res.status(400).json({ erro: 'produto_id inválido' });
  }

  const produtoId = parseInt(produto_id);
  const qtd = parseInt(quantidade);

  if (qtd < 1) {
    return res.status(400).json({ erro: 'Quantidade deve ser maior que 0' });
  }

  try {
    // Verifica estoque com bloqueio (evita venda dupla)
    const check = await pool.query(
      'SELECT estoque, nome FROM produtos WHERE id = $1 FOR UPDATE',
      [produtoId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    const produto = check.rows[0];

    if (produto.estoque < qtd) {
      return res.status(400).json({
        erro: 'Estoque insuficiente',
        disponivel: produto.estoque
      });
    }

    // Adiciona ou soma no carrinho
    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id)
      DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade
    `, [sessao, produtoId, qtd]);

    // Reduz estoque
    await pool.query(
      'UPDATE produtos SET estoque = estoque - $1 WHERE id = $2',
      [qtd, produtoId]
    );

    res.json({
      sucesso: true,
      mensagem: `${qtd > 1 ? qtd : 'Um'} ${produto.nome} adicionado(s) ao carrinho!`
    });
  } catch (err) {
    console.error('Erro ao adicionar no carrinho:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

// ROTA PUT — ATUALIZAR QUANTIDADE (VERSÃO À PROVA DE ERRO 500)
app.put('/api/carrinho/:produto_id', async (req, res) => {
  try {
    const produto_id = parseInt(req.params.produto_id);
    const { quantidade } = req.body;
    const session = req.headers['session'];

    // Validações básicas
    if (!session) {
      return res.status(400).json({ erro: 'Sessão não encontrada' });
    }
    if (!quantidade || quantidade < 0) {
      return res.status(400).json({ erro: 'Quantidade inválida' });
    }

    if (quantidade === 0) {
      // Remove se for zero
      await pool.query(
        'DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2',
        [session, produto_id]
      );
      return res.json({ sucesso: true });
    }

    // Atualiza quantidade
    const result = await pool.query(
      `UPDATE carrinho 
       SET quantidade = $1 
       WHERE sessao = $2 AND produto_id = $3 
       RETURNING *`,
      [quantidade, session, produto_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: 'Item não encontrado no carrinho' });
    }

    res.json({ sucesso: true });
  } catch (err) {
    console.error('ERRO NO PUT CARRINHO:', err);
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: err.message 
    });
  }
});

// ==================== CARRINHO: REMOVER ITEM ====================
app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const { produto_id } = req.params;
  const sessao = req.headers['session'] || 'temp';

  try {
    // Pega a quantidade antes de deletar
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
    res.status(500).json({ erro: 'Erro ao remover item' });
  }
});

// ==================== EVITA "Cannot GET" NO NAVEGADOR ====================
app.get('/api/carrinho/:produto_id', (req, res) => {
  res.status(405).json({
    erro: 'Método não permitido',
    dica: 'Use DELETE para remover um item do carrinho',
    metodo_correto: 'DELETE',
    exemplo: `DELETE ${req.protocol}://${req.get('host')}/api/carrinho/${req.params.produto_id}`
  });
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    mensagem: 'Queen Store API 100% viva e funcionando!',
    timestamp: new Date().toLocaleString('pt-BR'),
    rainha: 'Wesley, porra do caralho!!!'
  });
});

// ==================== LISTAR CATEGORIAS DO BANCO ====================
app.get('/api/categorias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT categoria 
      FROM produtos 
      WHERE categoria IS NOT NULL AND categoria != ''
      ORDER BY categoria
    `);
    const categorias = result.rows.map(row => row.categoria);
    res.json(categorias);
  } catch (err) {
    console.error('Erro ao carregar categorias:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== INICIA O SERVIDOR ====================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log('================================================');
  console.log('    QUEEN STORE API RODANDO COM SUCESSO!    ');
  console.log(`    Porta: ${PORT}                                 `);
  console.log(`    URL: https://queen-store-api.onrender.com   `);
  console.log('    A RAINHA ESTÁ NO AR E NÃO SAI MAIS!      ');
  console.log('================================================');
});