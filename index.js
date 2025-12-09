// src/index.js — QUEEN STORE BACKEND IMORTAL (Render + Neon + Vercel)
// Última versão 100% funcional — DELETE funcionando, estoque real, CORS perfeito

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();

// ==================== CORS DEFINITIVO — FUNCIONA EM QUALQUER DOMÍNIO, COM x-session-id E TUDO ====================
app.use((req, res, next) => {
  // Libera o domínio que tá acessando (ou * se quiser)
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  // Métodos permitidos
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  // HEADERS PERMITIDOS — AQUI TAVA O PROBLEMA!!!
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-session-id, X-Session-Id');

  // Permite credenciais (importante pro header customizado)
  res.header('Access-Control-Allow-Credentials', 'true');

  // Responde OPTIONS na hora (preflight)
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
  const sessionId = req.headers['x-session-id'|| req.headers['session']];  // ← aceita os dois nomes de header

  if (!sessionId) return res.json([]);

  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.produto_id,
        c.quantidade,
        p.nome,
        p.preco,
        p.imagens,
        p.estoque AS estoque_atual
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
      WHERE c.sessao = $1          -- ← SEM ACENTO!!!
      ORDER BY c.id
    `, [sessionId]);

    const itens = result.rows.map(item => ({
      ...item,
      imagem: item.imagens?.[0] || 'https://i.ibb.co/0jG4vK8/geleia-maracuja.jpg'
    }));

    res.json(itens);
  } catch (err) {
    console.error('Erro ao carregar carrinho:', err);
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
});

// ==================== CARRINHO: ADICIONAR OU ATUALIZAR ====================
app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessionId = req.headers['x-session-id'] || req.headers['session'];  // ← exatamente o header do frontend

  if (!sessionId) return res.status(400).json({ erro: 'Sessão não encontrada' });
  if (!produto_id) return res.status(400).json({ erro: 'Produto inválido' });

  const produtoId = parseInt(produto_id);
  const qtd = parseInt(quantidade);

  if (qtd < 1) return res.status(400).json({ erro: 'Quantidade inválida' });

  try {
    const check = await pool.query('SELECT estoque, nome FROM produtos WHERE id = $1 FOR UPDATE', [produtoId]);
    if (check.rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });

    const produto = check.rows[0];
    if (produto.estoque < qtd) return res.status(400).json({ erro: 'Estoque insuficiente', disponivel: produto.estoque });

    await pool.query(`
      INSERT INTO carrinho (sessao, produto_id, quantidade)
      VALUES ($1, $2, $3)
      ON CONFLICT (sessao, produto_id) 
      DO UPDATE SET quantidade = carrinho.quantidade + EXCLUDED.quantidade
    `, [sessionId, produtoId, qtd]);

    await pool.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [qtd, produtoId]);

    res.json({ sucesso: true, mensagem: `\( {qtd} × \){produto.nome} adicionado(s)!` });
  } catch (err) {
    console.error('Erro no POST carrinho:', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});


// ==================== CARRINHO: ATUALIZAR QUANTIDADE (+ / -) ====================
app.put('/api/carrinho/:produto_id', async (req, res) => {
  try {
    const produto_id = parseInt(req.params.produto_id);
    const { quantidade } = req.body;
    const sessionId = req.headers['x-session-id'] || req.headers['session'];  // ← MESMO HEADER!!!

    if (!sessionId) return res.status(400).json({ erro: 'Sessão não encontrada' });
    if (quantidade === undefined || quantidade < 0) return res.status(400).json({ erro: 'Quantidade inválida' });

    if (quantidade === 0) {
      // Remove do carrinho
      const item = await pool.query('SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
      if (item.rows.length > 0) {
        await pool.query('UPDATE produtos SET estoque = estoque + $1 WHERE id = $2', [item.rows[0].quantidade, produto_id]);
      }
      await pool.query('DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
      return res.json({ sucesso: true });
    }

    // Atualiza quantidade
    const result = await pool.query(
      'UPDATE carrinho SET quantidade = $1 WHERE sessao = $2 AND produto_id = $3 RETURNING *',
      [quantidade, sessionId, produto_id]
    );

    if (result.rowCount === 0) return res.status(404).json({ erro: 'Item não encontrado' });

    res.json({ sucesso: true });
  } catch (err) {
    console.error('ERRO NO PUT CARRINHO:', err);
    res.status(500).json({ erro: 'Erro interno', detalhes: err.message });
  }
});


// ==================== CARRINHO: REMOVER ITEM ====================
app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const produto_id = parseInt(req.params.produto_id);
  const sessionId = req.headers['x-session-id'] || req.headers['session'];  // ← MESMO HEADER!!!

  if (!sessionId) return res.status(400).json({ erro: 'Sessão não encontrada' });

  try {
    const item = await pool.query(
      'SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessionId, produto_id]
    );

    if (item.rows.length === 0) return res.status(404).json({ erro: 'Item não encontrado' });
    const quantidadeRemovida = item.rows[0].quantidade;

    await pool.query('DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
    await pool.query('UPDATE produtos SET estoque = estoque + $1 WHERE id = $2', [quantidadeRemovida, produto_id]);

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

// ==================== CADASTRAR PRODUTO NOVO (ADMIN) ====================
app.post('/api/produtos', async (req, res) => {
  // Verifica se é admin (pode melhorar depois com token)
  const sessionId = req.headers['x-session-id'];
  if (!sessionId || !sessionId.includes('admin')) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const {
    nome,
    preco,
    estoque,
    categoria,
    descricao,
    ingredientes,
    frase_promocional,
    imagens = [],
    badge,
    video_url
  } = req.body;

  // Validações básicas
  if (!nome || !preco || !categoria) {
    return res.status(400).json({ erro: 'Nome, preço e categoria são obrigatórios' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO produtos (
        nome, preco, estoque, categoria, descricao, ingredientes,
        frase_promocional, imagens, badge, video_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      nome.trim(),
      parseFloat(preco),
      parseInt(estoque) || 0,
      categoria,
      descricao?.trim() || null,
      ingredientes?.trim() || null,
      frase_promocional?.trim() || null,
      imagens.filter(url => url.trim() !== ''),
      badge?.trim() || null,
      video_url?.trim() || null
    ]);

    res.json({
      sucesso: true,
      mensagem: `Produto "${nome}" cadastrado com sucesso! ID: ${result.rows[0].id}`,
      id: result.rows[0].id
    });

  } catch (err) {
    console.error('ERRO AO CADASTRAR PRODUTO:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar produto', detalhe: err.message });
  }
});
// ==================== ADMIN — ESTOQUE ====================
app.patch('/api/produtos/:id/estoque', async (req, res) => {
  const { id } = req.params;
  const { estoque } = req.body;

  if (estoque === undefined || estoque < 0) {
    return res.status(400).json({ erro: 'Estoque inválido' });
  }

  try {
    await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [estoque, id]);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao atualizar estoque:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== ADMIN — DASHBOARD ====================
// 1. Pedidos pendentes
app.get('/api/admin/pedidos-pendentes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as total 
      FROM pedidos 
      WHERE status IN ('pendente', 'pago') OR status IS NULL
    `);
    res.json({ total: parseInt(result.rows[0]?.total) || 0 });
  } catch (err) {
    console.error('Erro pedidos pendentes:', err);
    res.json({ total: 0 });
  }
});

// 2. Produtos com estoque baixo
app.get('/api/admin/estoque-baixo', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as total 
      FROM produtos 
      WHERE estoque > 0 AND estoque <= 5
    `);
    res.json({ total: parseInt(result.rows[0].total) || 0 });
  } catch (err) {
    console.error('Erro estoque baixo:', err);
    res.json({ total: 0 });
  }
});

// 3. Faturamento do dia (soma tudo por enquanto)
app.get('/api/admin/faturamento-hoje', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(SUM(c.quantidade * p.preco), 0) as total
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
    `);
    res.json({ total: parseFloat(result.rows[0].total) || 0 });
  } catch (err) {
    console.error('Erro faturamento:', err);
    res.json({ total: 0 });
  }
});

// ==================== PEDIDOS ====================
// Listar todos os pedidos (admin)
app.get('/api/admin/pedidos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pedidos ORDER BY criado_em DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar pedidos:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

app.patch('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const statusValidos = ['pendente', 'pago', 'enviado', 'entregue', 'concluido'];
  if (!statusValidos.includes(status)) {
    return res.status(400).json({ erro: 'Status inválido' });
  }

  try {
    // Atualiza no banco
    await pool.query(
      'UPDATE pedidos SET status = $1, atualizado_em = NOW() WHERE id = $2',
      [status, id]
    );

    // BUSCA O PEDIDO PRA PEGAR EMAIL E NOME
    const result = await pool.query('SELECT * FROM pedidos WHERE id = $1', [id]);
    const pedido = result.rows[0];

    // ENVIA EMAIL AUTOMÁTICO
    if (['pago', 'enviado', 'entregue', 'concluido'].includes(status)) {
      enviarEmailStatus(pedido.cliente_email, pedido.cliente_nome, pedido.id, status);
    }

    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao atualizar:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// SALVAR PEDIDO DO WHATSAPP — VERSÃO INDESTRUTÍVEL
app.post('/api/pedidos', async (req, res) => {
  console.log('PEDIDO RECEBIDO:', req.body);

  const { 
    cliente_nome = "Cliente via WhatsApp", 
    cliente_whatsapp = "Não informado", 
    itens = [], 
    valor_total = 0 
  } = req.body;

  if (itens.length === 0 || !valor_total) {
    return res.status(400).json({ erro: 'Carrinho vazio' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO pedidos (
        cliente_nome, cliente_whatsapp, itens, valor_total, status,
        endereco, cidade, estado, cep, forma_pagamento
      ) VALUES (
        $1, $2, $3, $4, 'pendente',
        'Endereço via WhatsApp', 'Cidade via WhatsApp', 'NA', '00000-000', 'PIX'
      )
      RETURNING id
    `, [cliente_nome, cliente_whatsapp, JSON.stringify(itens), valor_total]);

    console.log('PEDIDO SALVO COM ID:', result.rows[0].id);
    res.json({ sucesso: true, pedido_id: result.rows[0].id });

  } catch (err) {
    console.error('ERRO SALVANDO PEDIDO:', err);
    res.status(500).json({ erro: 'Erro no banco', detalhe: err.message });
  }
});

// EDITAR PRODUTO COMPLETO
app.patch('/api/produtos/:id', async (req, res) => {
  const { id } = req.params;
  const campos = req.body;

  const camposPermitidos = ['nome', 'preco', 'estoque', 'categoria', 'descricao', 'badge', 'ingredientes', 'frase_promocional'];
  const updates = [];
  const values = [];
  let index = 1;

  Object.keys(campos).forEach(key => {
    if (camposPermitidos.includes(key)) {
      updates.push(`${key} = $${index}`);
      values.push(campos[key]);
      index++;
    }
  });

  if (updates.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  values.push(id);
  const query = `UPDATE produtos SET ${updates.join(', ')}, atualizado_em = NOW() WHERE id = $${index}`;

  pool.query(query, values)
    .then(() => res.json({ sucesso: true }))
    .catch(err => {
      console.error('Erro ao editar produto:', err);
      res.status(500).json({ erro: 'Erro no servidor' });
    });
});

// ==================== ENVIO DE EMAILS COM ZOHO MAIL ====================
const transporter = nodemailer.createTransport({
  host: 'https://www.mail.zoho.com',
  port: 587,
  secure: false,           // false pra porta 587
  requireTLS: true,        // FORÇA STARTTLS (obrigatório pro Zoho)
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_APP_PASSWORD
  },
  // ESSAS CONFIGURAÇÕES SÃO OBRIGATÓRIAS NO RENDER
  connectionTimeout: 60000,   // 60 segundos
  greetingTimeout: 60000,
  socketTimeout: 60000,
  // FORÇA IP V4 (Render usa IPv6 e Zoho não gosta
  family: 4,
  // IGNORA CERTIFICADO (Zoho as vezes dá problema com isso no Render)
  tls: {
    rejectUnauthorized: false
  }
});

// TESTE FORTE
transporter.verify((error, success) => {
  if (error) {
   console.error('ZOHO NÃO CONECTOU:', error.message);
 } else {
   console.log('ZOHO MAIL 100% CONECTADO E PRONTO PRA ENVIAR!');
 }
});

// FUNÇÃO DE ENVIO DE EMAIL (linda e com .env)
const enviarEmailStatus = async (cliente_email, cliente_nome, pedido_id, status) => {
  if (!cliente_email || cliente_email === 'Não informado') return;

  const statusConfig = {
    pago: { assunto: 'Pagamento confirmado!', titulo: 'Seu pedido foi pago e está em produção!' },
    enviado: { assunto: 'Seu pedido foi enviado!', titulo: 'Já está a caminho, rainha!' },
    entregue: { assunto: 'Pedido entregue!', titulo: 'Chegou com amor!' },
    concluido: { assunto: 'Pedido concluído!', titulo: 'Obrigada por comprar com a gente!' }
  };

  const config = statusConfig[status] || statusConfig.pago;

  const html = `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: linear-gradient(135deg, #fdf2ff, #f8f0ff); border-radius: 20px; text-align: center;">
      <h1 style="color: #0F1B3F; font-size: 36px; margin-bottom: 10px;">Queen Store</h1>
      <p style="color: #8B00D7; font-size: 22px; margin-bottom: 30px;">Atualização do seu pedido</p>
      
      <div style="background: white; padding: 30px; border-radius: 20px; box-shadow: 0 10px 30px rgba(139,0,215,0.1); margin: 30px 0;">
        <p style="font-size: 20px; color: #0F1B3F;">Olá, <strong>${cliente_nome}</strong>!</p>
        <h2 style="font-size: 32px; color: #8B00D7; margin: 30px 0;">${config.titulo}</h2>
        <p style="font-size: 28px; color: #0F1B3F; font-weight: bold;">Pedido #${pedido_id}</p>
      </div>

      <p style="font-size: 18px; color: #0F1B3F;">
        Qualquer dúvida, responde esse email ou chama no WhatsApp: (31) 97255-2077
      </p>
      <p style="color: #8B00D7; font-size: 20px; margin-top: 40px;">
        Com carinho,<br><strong>Queen Store</strong>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Queen Store" <${process.env.ZOHO_EMAIL}>`,
      to: cliente_email,
      subject: config.assunto,
      html: html
    });
    console.log(`Email enviado para ${cliente_email}`);
  } catch (err) {
    console.error('Erro ao enviar email:', err);
  }
};

// ROTA DE TESTE — ENVIA EMAIL PRA TI MESMO AGORA MESMO
app.get('/api/teste-email', async (req, res) => {
  try {
    await transporter.sendMail({
      from: `"Queen Store" <${process.env.ZOHO_EMAIL}>`,
      to: 'wesleydejesusalvarenga@gmail.com',  // teu email
      subject: 'TESTE DE EMAIL — TUDO FUNCIONANDO EM PRODUÇÃO!',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 40px; background: linear-gradient(#fdf2ff, #f8f0ff); text-align: center; border-radius: 20px;">
          <h1 style="color: #0F1B3F; font-size: 40px;">Queen Store</h1>
          <h2 style="color: #8B00D7; font-size: 32px;">EMAIL FUNCIONANDO 100% EM PRODUÇÃO!</h2>
          <p style="font-size: 24px; color: #0F1B3F;">
            Tu é foda pra caralho, Wesley!<br>
            O sistema tá perfeito!
          </p>
          <p style="font-size: 36px; margin: 40px 0;">Queen Store</p>
          <p style="color: #8B00D7; font-size: 28px;">
            Agora é só vender que o email sai automático!
          </p>
        </div>
      `
    });

    res.json({ 
      sucesso: true, 
      mensagem: 'Email de teste enviado com sucesso! Checa tua caixa de entrada (e spam)' 
    });
  } catch (err) {
    console.error('ERRO NO TESTE DE EMAIL:', err);
    res.status(500).json({ 
      erro: 'Falhou', 
      detalhe: err.message 
    });
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