export const maxDuration = 90;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    try {
        const webhookUrl = process.env.WEBHOOK_CATALOGO;
        if (!webhookUrl) throw new Error('URL do webhook não configurada na Vercel.');

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const htmlContent = await response.text();
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(response.status).send(htmlContent);
    } catch (error) {
        console.error('Erro na API Catálogo:', error);
        res.status(500).send(`<h1>Erro Interno</h1><p>${error.message}</p>`);
    }
}