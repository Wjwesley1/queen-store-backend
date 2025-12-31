// src/index.js — QUEEN STORE BACKEND IMORTAL (Render + Neon + Vercel)
// Última versão 100% funcional — DELETE funcionando, estoque real, CORS perfeito

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const brevo = require('@getbrevo/brevo');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const apiInstance = new brevo.TransactionalEmailsApi();
const JWT_SECRET = process.env.JWT_SECRET || 'queen-store-secret-super-seguro-2025';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); 


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

// SALVAR PEDIDO COM EMAIL DO CLIENTE — VERSÃO QUE SALVA TUDO
app.post('/api/pedidos', async (req, res) => {
  console.log('PEDIDO RECEBIDO:', req.body);

  const { 
    cliente_nome = "Cliente via WhatsApp", 
    cliente_whatsapp = "Não informado", 
    cliente_email = "Não informado",
    itens = [], 
    valor_total = 0 
  } = req.body;

  if (itens.length === 0 || !valor_total) {
    return res.status(400).json({ erro: 'Carrinho vazio' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO pedidos (
        cliente_nome, cliente_whatsapp, cliente_email, itens, valor_total, status,
        endereco, cidade, estado, cep, forma_pagamento
      ) VALUES (
        $1, $2, $3, $4, $5, 'pendente',
        'Endereço via WhatsApp', 'Cidade via WhatsApp', 'NA', '00000-000', 'PIX'
      )
      RETURNING id
    `, [cliente_nome, cliente_whatsapp, cliente_email, JSON.stringify(itens), valor_total]);

    console.log('PEDIDO SALVO COM ID:', result.rows[0].id, 'EMAIL:', cliente_email);
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

// REENVIO DE EMAIL DE VERIFICAÇÃO
app.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'Email obrigatório' });
  }

  try {
    const result = await pool.query(`
      SELECT id, nome, is_verified 
      FROM clientes 
      WHERE email = $1
    `, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Email não encontrado' });
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.status(400).json({ erro: 'Conta já verificada' });
    }

    // Novo token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await pool.query(`
      UPDATE clientes 
      SET verification_token = $1, verification_expires = $2 
      WHERE id = $3
    `, [token, expires, user.id]);

    const verifyLink = `https://queen-store-frontend.vercel.app/verify/${token}`;

    const sendSmtpEmail = {
      to: [{ email: email, name: user.nome }],
      sender: { name: 'Queen Store', email: 'contato@queenstore.store' },
      subject: 'Reenvio: Confirme sua conta Queen Store 💜',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px 20px; background: linear-gradient(#fdf2ff, #f8f0ff); border-radius: 20px; text-align: center;">
          <h1 style="color: #0F1B3F; font-size: 36px;">Queen Store</h1>
          <p style="color: #8B00D7; font-size: 22px;">Olá, <strong>${user.nome}</strong>!</p>
          <h2 style="font-size: 32px; color: #8B00D7;">Reenvio de Confirmação</h2>
          <p style="font-size: 20px; color: #0F1B3F;">Clique abaixo para confirmar sua conta:</p>
          <a href="${verifyLink}" style="background:#0F1B3F;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;margin:20px 0;">
            Confirmar Conta Agora
          </a>
          <p style="font-size: 16px; color: #0F1B3F;">Se o botão não funcionar, copie: ${verifyLink}</p>
          <p style="font-size: 16px; color: #0F1B3F;">Link expira em 24 horas.</p>
          <p style="color: #8B00D7; font-size: 22px;">Com carinho,<br><strong>Queen Store</strong></p>
        </div>
      `
    };

    await apiInstance.sendTransacEmail(sendSmtpEmail);

    res.json({ sucesso: true, mensagem: 'Email de confirmação reenviado!' });
  } catch (err) {
    console.error('Erro Brevo reenvio:', err);
    res.status(500).json({ erro: 'Erro ao reenviar email' });
  }
});

// LOGIN (EMAIL + SENHA)
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha obrigatórios' });
  }

  try {
    const result = await pool.query('SELECT * FROM clientes WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(400).json({ erro: 'Email ou senha incorretos' });
    }

    const cliente = result.rows[0];

    // Se logou só com Google, não tem senha
    if (!cliente.senha_hash) {
      return res.status(400).json({ erro: 'Essa conta usa login com Google' });
    }

    const senhaValida = await bcrypt.compare(senha, cliente.senha_hash);
    if (!senhaValida) {
      return res.status(400).json({ erro: 'Email ou senha incorretos' });
    }

    const token = jwt.sign({ clienteId: cliente.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ sucesso: true, token, cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// LOGIN COM GOOGLE
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body; // token do Google vindo do frontend

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.REACT_APP_GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload['sub'];
    const email = payload['email'];
    const nome = payload['name'] || email.split('@')[0];

    // Busca ou cria cliente
    let result = await pool.query('SELECT * FROM clientes WHERE google_id = $1 OR email = $2', [googleId, email]);
    let cliente = result.rows[0];

    if (!cliente) {
      // Cria novo cliente
      result = await pool.query(`
        INSERT INTO clientes (nome, email, google_id)
        VALUES ($1, $2, $3)
        RETURNING id, nome, email
      `, [nome, email, googleId]);

      cliente = result.rows[0];
    } else if (!cliente.google_id) {
      // Vincula Google à conta existente
      await pool.query('UPDATE clientes SET google_id = $1 WHERE id = $2', [googleId, cliente.id]);
      cliente.google_id = googleId;
    }

    const jwtToken = jwt.sign({ clienteId: cliente.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ sucesso: true, token: jwtToken, cliente: { id: cliente.id, nome: cliente.nome || nome, email: cliente.email || email }});
  } catch (err) {
    console.error('Erro login Google:', err);
    res.status(400).json({ erro: 'Token Google inválido' });
  }
});

// MIDDLEWARE PRA PROTEGER ROTAS
const autenticar = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];

  if (!token) {
    return res.status(401).json({ erro: 'Token não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT id, nome, email FROM clientes WHERE id = $1', [decoded.clienteId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ erro: 'Cliente não encontrado' });
    }

    req.cliente = result.rows[0];
    next();
  } catch (err) {
    res.status(401).json({ erro: 'Token inválido' });
  }
};

// EXEMPLO DE ROTA PROTEGIDA — HISTÓRICO DE PEDIDOS DO CLIENTE
app.get('/api/cliente/pedidos', autenticar, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM pedidos 
      WHERE cliente_email = $1 OR cliente_whatsapp = $2
      ORDER BY criado_em DESC
    `, [req.cliente.email, req.cliente.whatsapp || '']);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar pedidos' });
  }
});

// ROTA PRA PEGAR DADOS DO CLIENTE LOGADO
app.get('/api/cliente/perfil', autenticar, async (req, res) => {
  res.json({ cliente: req.cliente });
});

// ATUALIZAR CADASTRO (NOME E EMAIL BLOQUEADOS)
app.patch('/api/cliente/atualizar', autenticar, async (req, res) => {
  const { whatsapp, endereco, cidade, estado, cep, complemento, senha, senha_confirm } = req.body;

  if (senha && senha !== senha_confirm) {
    return res.status(400).json({ erro: 'Senhas não coincidem' });
  }

  try {
    let query = 'UPDATE clientes SET ';
    const values = [];
    let paramIndex = 1;

    if (whatsapp !== undefined) {
      query += `whatsapp = $${paramIndex}, `;
      values.push(whatsapp);
      paramIndex++;
    }
    if (endereco !== undefined) {
      query += `endereco = $${paramIndex}, `;
      values.push(endereco);
      paramIndex++;
    }
    if (cidade !== undefined) {
      query += `cidade = $${paramIndex}, `;
      values.push(cidade);
      paramIndex++;
    }
    if (estado !== undefined) {
      query += `estado = $${paramIndex}, `;
      values.push(estado);
      paramIndex++;
    }
    if (cep !== undefined) {
      query += `cep = $${paramIndex}, `;
      values.push(cep);
      paramIndex++;
    }
    if (complemento !== undefined) {
      query += `complemento = $${paramIndex}, `;
      values.push(complemento);
      paramIndex++;
    }
    if (senha) {
      const senhaHash = await bcrypt.hash(senha, 10);
      query += `senha_hash = $${paramIndex}, `;
      values.push(senhaHash);
      paramIndex++;
    }

    // Remove vírgula extra
    query = query.replace(/, $/, '');

    query += ` WHERE id = $${paramIndex}`;
    values.push(req.cliente.id);

    await pool.query(query, values);

    res.json({ sucesso: true, mensagem: 'Cadastro atualizado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar cadastro' });
  }
});

// REGISTRO (adapta tua rota /api/auth/register)
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, whatsapp } = req.body;

  // ... teu código de hash senha e insert ...

  // Gera token único
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  await pool.query(`
    UPDATE clientes 
    SET verification_token = $1, verification_expires = $2, is_verified = false 
    WHERE email = $3
  `, [token, expires, email]);

  // Link de verificação
  const verifyLink = `https://queen-store-frontend.vercel.app/verify/${token}`;

  // Email bonito
  await transporter.sendMail({
    from: '"Queen Store" <seuemail@gmail.com>',
    to: email,
    subject: 'Confirme sua conta Queen Store 💜',
    html: `
      <h1>Olá, ${nome}! Bem-vinda à Queen Store 👑</h1>
      <p>Clique no botão abaixo para confirmar sua conta e começar a comprar:</p>
      <a href="${verifyLink}" style="background:#0F1B3F;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;">Confirmar Conta</a>
      <p>Se o botão não funcionar, copie o link: ${verifyLink}</p>
      <p>O link expira em 24 horas.</p>
      <p>Com amor, Queen Store 💜</p>
    `
  });

  res.json({ sucesso: true, mensagem: 'Cadastro realizado! Confira seu email para confirmar a conta.' });
});

// ROTA DE VERIFICAÇÃO
app.get('/api/auth/verify/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(`
      SELECT * FROM clientes 
      WHERE verification_token = $1 AND verification_expires > NOW()
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    await pool.query(`
      UPDATE clientes 
      SET is_verified = true, verification_token = NULL, verification_expires = NULL 
      WHERE id = $1
    `, [result.rows[0].id]);

    res.json({ sucesso: true, mensagem: 'Conta verificada! Pode logar agora.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao verificar conta' });
  }
});

// BLOQUEIA LOGIN SE NÃO VERIFICADO (adapta tua rota de login)
app.post('/api/auth/login', async (req, res) => {
  // ... teu código de login ...

  if (!cliente.is_verified) {
    return res.status(403).json({ erro: 'Confirme sua conta pelo email antes de logar' });
  }

  // ... gera token e responde ...
});

// REENVIAR EMAIL DE VERIFICAÇÃO
app.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body;

  try {
    const result = await pool.query('SELECT id, nome, is_verified FROM clientes WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ erro: 'Email não encontrado' });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ erro: 'Conta já verificada' });
    }

    // Gera novo token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(`
      UPDATE clientes 
      SET verification_token = $1, verification_expires = $2 
      WHERE id = $3
    `, [token, expires, user.id]);

    const verifyLink = `https://queen-store-frontend.vercel.app/verify/${token}`;

    // Envia email novo
    await transporter.sendMail({
      from: '"Queen Store" <seuemail@gmail.com>',
      to: email,
      subject: 'Reenvio: Confirme sua conta Queen Store 💜',
      html: `
        <h1>Olá, ${user.nome}! 👑</h1>
        <p>Você pediu para reenviar o email de confirmação.</p>
        <p>Clique abaixo para ativar sua conta:</p>
        <a href="${verifyLink}" style="background:#0F1B3F;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;">Confirmar Conta Agora</a>
        <p>Se o botão não funcionar: ${verifyLink}</p>
        <p>O link expira em 24 horas.</p>
        <p>Com amor, Queen Store 💜</p>
      `
    });

    res.json({ sucesso: true, mensagem: 'Email de confirmação reenviado!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao reenviar email' });
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