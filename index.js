// src/index.js — QUEEN STORE BACKEND IMORTAL
// Versão corrigida: Drive OK, sem rotas duplicadas, crypto importado, brevo unificado

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const brevo = require('@getbrevo/brevo');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // ← CORRIGIDO: estava faltando
const { OAuth2Client } = require('google-auth-library');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();

// ==================== BREVO (email) ====================
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

// ==================== CONSTANTES ====================
const JWT_SECRET = process.env.JWT_SECRET;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const upload = multer({ dest: 'uploads/' });

// ==================== CORS ====================
app.use(cors({
  origin: function (origin, callback) {
    const allowed = [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://queen-store-frontend.vercel.app',
      'https://queen-store-frontend.onrender.com',
      'https://www.queenstore.store',
      'https://queenstore.store'
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id', 'X-Session-Id', 'Origin', 'Accept'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json());

// ==================== BANCO (Neon PostgreSQL) ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==================== CLOUDINARY ====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function uploadToCloudinary(filePath, originalName) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'queen-store/produtos',
    public_id: `${Date.now()}-${originalName.replace(/\.[^/.]+$/, '')}`,
    resource_type: 'image'
  });

  fs.unlinkSync(filePath); // remove arquivo temporário

  return result.secure_url; // link HTTPS direto, perfeito para <img src="">
}

// ==================== HELPER: ENVIAR EMAIL ====================
async function enviarEmail(para, nome, assunto, htmlContent) {
  const sendSmtpEmail = {
    to: [{ email: para, name: nome }],
    sender: { name: 'Queen Store', email: 'contato@queenstore.store' },
    subject: assunto,
    htmlContent
  };
  await apiInstance.sendTransacEmail(sendSmtpEmail);
}

function emailConfirmacaoPedido(nome, pedidoId, itens, valorTotal) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px 20px; background: linear-gradient(#fdf2ff, #f8f0ff); border-radius: 20px; text-align: center;">
      <h1 style="color: #0F1B3F;">Queen Store</h1>
      <p style="color: #8B00D7; font-size: 22px;">Olá, <strong>${nome}</strong>!</p>
      <h2 style="color: #8B00D7;">Seu pedido foi recebido!</h2>
      <p style="font-size: 28px; color: #0F1B3F; font-weight: bold;">Pedido #${pedidoId}</p>
      <p style="font-size: 18px; color: #0F1B3F;">
        ${itens.map(i => `${i.nome} × ${i.quantidade} — R$ ${(i.preco * i.quantidade).toFixed(2)}`).join('<br>')}
      </p>
      <p style="font-size: 24px; color: #0F1B3F; font-weight: bold;">Total: R$ ${valorTotal.toFixed(2)}</p>
      <p style="font-size: 16px; color: #0F1B3F; margin-top: 30px;">Dúvidas? WhatsApp: (31) 97255-2077</p>
      <p style="color: #8B00D7; font-size: 20px;">Com carinho,<br><strong>Queen Store</strong></p>
    </div>
  `;
}

function emailVerificacaoConta(nome, verifyLink) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px 20px; background: linear-gradient(#fdf2ff, #f8f0ff); border-radius: 20px; text-align: center;">
      <h1 style="color: #0F1B3F;">Queen Store</h1>
      <p style="color: #8B00D7; font-size: 22px;">Olá, <strong>${nome}</strong>! Bem-vinda 👑</p>
      <h2 style="color: #8B00D7;">Confirme sua conta</h2>
      <p style="font-size: 18px; color: #0F1B3F;">Clique abaixo para ativar sua conta:</p>
      <a href="${verifyLink}" style="background:#0F1B3F;color:white;padding:15px 30px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;margin:20px 0;">
        Confirmar Conta Agora
      </a>
      <p style="font-size: 14px; color: #666;">Se o botão não funcionar, acesse: ${verifyLink}</p>
      <p style="font-size: 14px; color: #666;">Link expira em 24 horas.</p>
      <p style="color: #8B00D7; font-size: 20px;">Com carinho,<br><strong>Queen Store</strong></p>
    </div>
  `;
}

function emailStatusPedido(nome, pedidoId, status) {
  const mensagens = {
    pago: 'Seu pagamento foi confirmado! 🎉',
    enviado: 'Seu pedido foi enviado! 🚚',
    entregue: 'Seu pedido foi entregue! 💜',
    concluido: 'Pedido concluído! Obrigada pela preferência 👑'
  };
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px 20px; background: linear-gradient(#fdf2ff, #f8f0ff); border-radius: 20px; text-align: center;">
      <h1 style="color: #0F1B3F;">Queen Store</h1>
      <p style="color: #8B00D7; font-size: 22px;">Olá, <strong>${nome}</strong>!</p>
      <h2 style="color: #8B00D7;">${mensagens[status] || 'Status atualizado!'}</h2>
      <p style="font-size: 24px; color: #0F1B3F; font-weight: bold;">Pedido #${pedidoId}</p>
      <p style="font-size: 16px; color: #0F1B3F;">Dúvidas? WhatsApp: (31) 97255-2077</p>
      <p style="color: #8B00D7; font-size: 20px;">Com carinho,<br><strong>Queen Store</strong></p>
    </div>
  `;
}

// ==================== MIDDLEWARE AUTH ====================
const autenticar = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT id, nome, email FROM clientes WHERE id = $1', [decoded.clienteId]);
    if (result.rows.length === 0) return res.status(401).json({ erro: 'Cliente não encontrado' });
    req.cliente = result.rows[0];
    next();
  } catch (err) {
    res.status(401).json({ erro: 'Token inválido' });
  }
};

// ==================== ROTA RAIZ ====================
app.get('/', (req, res) => {
  res.json({
    mensagem: 'Queen Store API IMORTAL',
    status: '100% NO AR',
    data: new Date().toLocaleString('pt-BR')
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toLocaleString('pt-BR') });
});

// ==================== PRODUTOS ====================

// LISTAR TODOS
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// BUSCAR UM PRODUTO
app.get('/api/produtos/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produtos WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// CADASTRAR PRODUTO COM UPLOAD DE IMAGENS ← rota única, sem duplicata
app.post('/api/produtos', upload.array('imagens', 4), async (req, res) => {
  try {
    const {
      nome, preco, estoque, categoria,
      descricao, ingredientes, frase_promocional, badge, video_url
    } = req.body;

    if (!nome || !preco || !categoria) {
      return res.status(400).json({ erro: 'Nome, preço e categoria são obrigatórios' });
    }

    // Faz upload das imagens pro Drive e coleta os links
    const imagensLinks = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const link = await uploadToCloudinary(file.path, file.originalname);
        imagensLinks.push(link);
      }
    }

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
      JSON.stringify(imagensLinks),
      badge?.trim() || null,
      video_url?.trim() || null
    ]);

    res.status(201).json({
      sucesso: true,
      mensagem: `Produto "${nome}" cadastrado com sucesso!`,
      id: result.rows[0].id,
      imagens: imagensLinks
    });
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar produto', detalhe: err.message });
  }
});

// EDITAR PRODUTO (campos texto)
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
  // CORRIGIDO: removido atualizado_em (coluna não existe no banco)
  const query = `UPDATE produtos SET ${updates.join(', ')} WHERE id = $${index}`;

  try {
    await pool.query(query, values);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao editar produto:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ATUALIZAR ESTOQUE
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

// DELETAR PRODUTO
app.delete('/api/produtos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao deletar produto:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== CATEGORIAS ====================
app.get('/api/categorias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT categoria FROM produtos
      WHERE categoria IS NOT NULL AND categoria != ''
      ORDER BY categoria
    `);
    res.json(result.rows.map(row => row.categoria));
  } catch (err) {
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== CARRINHO ====================
app.get('/api/carrinho', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.headers['session'];
  if (!sessionId) return res.json([]);

  try {
    const result = await pool.query(`
      SELECT c.id, c.produto_id, c.quantidade,
             p.nome, p.preco, p.imagens, p.estoque AS estoque_atual
      FROM carrinho c
      JOIN produtos p ON c.produto_id = p.id
      WHERE c.sessao = $1
      ORDER BY c.id
    `, [sessionId]);

    const itens = result.rows.map(item => ({
      ...item,
      imagem: item.imagens?.[0] || null
    }));

    res.json(itens);
  } catch (err) {
    console.error('Erro ao carregar carrinho:', err);
    res.status(500).json({ erro: 'Erro ao carregar carrinho' });
  }
});

app.post('/api/carrinho', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  const sessionId = req.headers['x-session-id'] || req.headers['session'];

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

    res.json({ sucesso: true, mensagem: `${qtd} × ${produto.nome} adicionado(s)!` });
  } catch (err) {
    console.error('Erro no POST carrinho:', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.put('/api/carrinho/:produto_id', async (req, res) => {
  const produto_id = parseInt(req.params.produto_id);
  const { quantidade } = req.body;
  const sessionId = req.headers['x-session-id'] || req.headers['session'];

  if (!sessionId) return res.status(400).json({ erro: 'Sessão não encontrada' });
  if (quantidade === undefined || quantidade < 0) return res.status(400).json({ erro: 'Quantidade inválida' });

  try {
    if (quantidade === 0) {
      const item = await pool.query('SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
      if (item.rows.length > 0) {
        await pool.query('UPDATE produtos SET estoque = estoque + $1 WHERE id = $2', [item.rows[0].quantidade, produto_id]);
      }
      await pool.query('DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
      return res.json({ sucesso: true });
    }

    const result = await pool.query(
      'UPDATE carrinho SET quantidade = $1 WHERE sessao = $2 AND produto_id = $3 RETURNING *',
      [quantidade, sessionId, produto_id]
    );

    if (result.rowCount === 0) return res.status(404).json({ erro: 'Item não encontrado' });
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro no PUT carrinho:', err);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.delete('/api/carrinho/:produto_id', async (req, res) => {
  const produto_id = parseInt(req.params.produto_id);
  const sessionId = req.headers['x-session-id'] || req.headers['session'];

  if (!sessionId) return res.status(400).json({ erro: 'Sessão não encontrada' });

  try {
    const item = await pool.query(
      'SELECT quantidade FROM carrinho WHERE sessao = $1 AND produto_id = $2',
      [sessionId, produto_id]
    );

    if (item.rows.length === 0) return res.status(404).json({ erro: 'Item não encontrado' });

    await pool.query('DELETE FROM carrinho WHERE sessao = $1 AND produto_id = $2', [sessionId, produto_id]);
    await pool.query('UPDATE produtos SET estoque = estoque + $1 WHERE id = $2', [item.rows[0].quantidade, produto_id]);

    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao remover do carrinho:', err);
    res.status(500).json({ erro: 'Erro ao remover item' });
  }
});

app.get('/api/carrinho/:produto_id', (req, res) => {
  res.status(405).json({ erro: 'Use DELETE para remover um item do carrinho' });
});

// ==================== AUTH ====================

// REGISTRO
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, whatsapp } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios' });
  }

  try {
    const existe = await pool.query('SELECT id FROM clientes WHERE email = $1', [email.toLowerCase()]);
    if (existe.rows.length > 0) return res.status(400).json({ erro: 'Email já cadastrado' });

    const senhaHash = await bcrypt.hash(senha, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(`
      INSERT INTO clientes (nome, email, senha_hash, whatsapp, verification_token, verification_expires, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, false)
    `, [nome.trim(), email.toLowerCase(), senhaHash, whatsapp || null, token, expires]);

    const verifyLink = `https://queen-store-frontend.vercel.app/verify/${token}`;
    await enviarEmail(email, nome, 'Confirme sua conta Queen Store 💜', emailVerificacaoConta(nome, verifyLink));

    res.json({ sucesso: true, mensagem: 'Cadastro realizado! Confira seu email para confirmar a conta.' });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar', detalhe: err.message });
  }
});

// VERIFICAR CONTA
app.get('/api/auth/verify/:token', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM clientes
      WHERE verification_token = $1 AND verification_expires > NOW()
    `, [req.params.token]);

    if (result.rows.length === 0) return res.status(400).json({ erro: 'Token inválido ou expirado' });

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

// REENVIAR VERIFICAÇÃO
app.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'Email obrigatório' });

  try {
    const result = await pool.query('SELECT id, nome, is_verified FROM clientes WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Email não encontrado' });

    const user = result.rows[0];
    if (user.is_verified) return res.status(400).json({ erro: 'Conta já verificada' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(`
      UPDATE clientes SET verification_token = $1, verification_expires = $2 WHERE id = $3
    `, [token, expires, user.id]);

    const verifyLink = `https://queen-store-frontend.vercel.app/verify/${token}`;
    await enviarEmail(email, user.nome, 'Reenvio: Confirme sua conta Queen Store 💜', emailVerificacaoConta(user.nome, verifyLink));

    res.json({ sucesso: true, mensagem: 'Email de confirmação reenviado!' });
  } catch (err) {
    console.error('Erro no reenvio:', err);
    res.status(500).json({ erro: 'Erro ao reenviar email' });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });

  try {
    const result = await pool.query('SELECT * FROM clientes WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(400).json({ erro: 'Email ou senha incorretos' });

    const cliente = result.rows[0];

    if (!cliente.senha_hash) return res.status(400).json({ erro: 'Essa conta usa login com Google' });

    if (!cliente.is_verified) return res.status(403).json({ erro: 'Confirme sua conta pelo email antes de logar' });

    const senhaValida = await bcrypt.compare(senha, cliente.senha_hash);
    if (!senhaValida) return res.status(400).json({ erro: 'Email ou senha incorretos' });

    const token = jwt.sign({ clienteId: cliente.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ sucesso: true, token, cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// LOGIN COM GOOGLE
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload['sub'];
    const email = payload['email'];
    const nome = payload['name'] || email.split('@')[0];

    let result = await pool.query('SELECT * FROM clientes WHERE google_id = $1 OR email = $2', [googleId, email]);
    let cliente = result.rows[0];

    if (!cliente) {
      result = await pool.query(`
        INSERT INTO clientes (nome, email, google_id, is_verified)
        VALUES ($1, $2, $3, true)
        RETURNING id, nome, email
      `, [nome, email, googleId]);
      cliente = result.rows[0];
    } else if (!cliente.google_id) {
      await pool.query('UPDATE clientes SET google_id = $1, is_verified = true WHERE id = $2', [googleId, cliente.id]);
    }

    const jwtToken = jwt.sign({ clienteId: cliente.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ sucesso: true, token: jwtToken, cliente: { id: cliente.id, nome: cliente.nome || nome, email: cliente.email || email } });
  } catch (err) {
    console.error('Erro login Google:', err);
    res.status(400).json({ erro: 'Token Google inválido' });
  }
});

// ==================== CLIENTE ====================

app.get('/api/clientes/perfil', autenticar, async (req, res) => {
  res.json({ cliente: req.cliente });
});

app.get('/api/cliente/dados', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT nome, email, whatsapp, enderecos, cidade, estado, cep, complemento FROM clientes WHERE id = $1',
      [req.cliente.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Dados não encontrados' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.get('/api/cliente/enderecos', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT whatsapp, enderecos, cidade, estado, cep, complemento FROM clientes WHERE id = $1',
      [req.cliente.id]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar endereços' });
  }
});

app.patch('/api/cliente/enderecos', autenticar, async (req, res) => {
  const { whatsapp, enderecos, cidade, estado, cep, complemento } = req.body;
  try {
    await pool.query(`
      UPDATE clientes SET
        whatsapp = COALESCE($1, whatsapp),
        enderecos = COALESCE($2, enderecos),
        cidade = COALESCE($3, cidade),
        estado = COALESCE($4, estado),
        cep = COALESCE($5, cep),
        complemento = COALESCE($6, complemento)
      WHERE id = $7
    `, [whatsapp || null, enderecos || null, cidade || null, estado || null, cep || null, complemento || null, req.cliente.id]);
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao salvar endereços' });
  }
});

app.patch('/api/clientes/atualizar', autenticar, async (req, res) => {
  const { whatsapp, enderecos, cidade, estado, cep, complemento, senha, senha_confirm } = req.body;

  if (senha && senha !== senha_confirm) return res.status(400).json({ erro: 'Senhas não coincidem' });

  try {
    const fields = [];
    const values = [];
    let i = 1;

    const add = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

    if (whatsapp !== undefined) add('whatsapp', whatsapp);
    if (enderecos !== undefined) add('enderecos', enderecos);
    if (cidade !== undefined) add('cidade', cidade);
    if (estado !== undefined) add('estado', estado);
    if (cep !== undefined) add('cep', cep);
    if (complemento !== undefined) add('complemento', complemento);
    if (senha) add('senha_hash', await bcrypt.hash(senha, 10));

    if (fields.length === 0) return res.status(400).json({ erro: 'Nada para atualizar' });

    values.push(req.cliente.id);
    await pool.query(`UPDATE clientes SET ${fields.join(', ')} WHERE id = $${i}`, values);
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar cadastro' });
  }
});

app.get('/api/clientes/pedidos', autenticar, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pedidos WHERE cliente_email = $1 ORDER BY criado_em DESC',
      [req.cliente.email]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar pedidos' });
  }
});

// ==================== PEDIDOS ====================

app.post('/api/pedidos', async (req, res) => {
  const {
    cliente_nome = 'Cliente',
    cliente_whatsapp = 'Não informado',
    cliente_email = 'Não informado',
    itens = [],
    valor_total = 0
  } = req.body;

  if (itens.length === 0 || !valor_total) return res.status(400).json({ erro: 'Carrinho vazio' });

  try {
    const result = await pool.query(`
      INSERT INTO pedidos (cliente_nome, cliente_whatsapp, cliente_email, itens, valor_total, status, criado_em)
      VALUES ($1, $2, $3, $4, $5, 'pendente', NOW())
      RETURNING id
    `, [cliente_nome, cliente_whatsapp, cliente_email, JSON.stringify(itens), valor_total]);

    const pedidoId = result.rows[0].id;

    if (cliente_email !== 'Não informado' && cliente_email.includes('@')) {
      await enviarEmail(
        cliente_email, cliente_nome,
        `Confirmação de Pedido #${pedidoId} - Queen Store 💜`,
        emailConfirmacaoPedido(cliente_nome, pedidoId, itens, valor_total)
      );
    }

    res.json({ sucesso: true, pedido_id: pedidoId });
  } catch (err) {
    console.error('Erro salvando pedido:', err);
    res.status(500).json({ erro: 'Erro no banco', detalhe: err.message });
  }
});

app.get('/api/admin/pedidos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pedidos ORDER BY criado_em DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

app.patch('/api/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const statusValidos = ['pendente', 'pago', 'enviado', 'entregue', 'concluido'];
  if (!statusValidos.includes(status)) return res.status(400).json({ erro: 'Status inválido' });

  try {
    await pool.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);

    const result = await pool.query('SELECT * FROM pedidos WHERE id = $1', [id]);
    const pedido = result.rows[0];

    if (['pago', 'enviado', 'entregue', 'concluido'].includes(status) && pedido.cliente_email?.includes('@')) {
      await enviarEmail(
        pedido.cliente_email, pedido.cliente_nome,
        `Atualização do Pedido #${id} - Queen Store`,
        emailStatusPedido(pedido.cliente_nome, id, status)
      );
    }

    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao atualizar pedido:', err);
    res.status(500).json({ erro: 'Erro no servidor' });
  }
});

// ==================== ADMIN DASHBOARD ====================

app.get('/api/admin/pedidos-pendentes', async (req, res) => {
  try {
    const result = await pool.query(`SELECT COUNT(*) as total FROM pedidos WHERE status IN ('pendente', 'pago') OR status IS NULL`);
    res.json({ total: parseInt(result.rows[0].total) || 0 });
  } catch (err) {
    res.json({ total: 0 });
  }
});

app.get('/api/admin/estoque-baixo', async (req, res) => {
  try {
    const result = await pool.query(`SELECT COUNT(*) as total FROM produtos WHERE estoque > 0 AND estoque <= 5`);
    res.json({ total: parseInt(result.rows[0].total) || 0 });
  } catch (err) {
    res.json({ total: 0 });
  }
});

app.get('/api/admin/faturamento-hoje', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(SUM(valor_total), 0) as total
      FROM pedidos
      WHERE DATE(criado_em) = CURRENT_DATE AND status != 'pendente'
    `);
    res.json({ total: parseFloat(result.rows[0].total) || 0 });
  } catch (err) {
    res.json({ total: 0 });
  }
});

// ==================== DESEJOS ====================
app.get('/api/desejos', autenticar, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.* FROM desejos d
      JOIN produtos p ON d.produto_id = p.id
      WHERE d.cliente_id = $1
    `, [req.cliente.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar desejos' });
  }
});

// ==================== INICIA SERVIDOR ====================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('================================================');
  console.log('    QUEEN STORE API RODANDO COM SUCESSO!        ');
  console.log(`    Porta: ${PORT}                              `);
  console.log('    A RAINHA ESTÁ NO AR E NÃO SAI MAIS!        ');
  console.log('================================================');
});