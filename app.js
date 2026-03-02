// app.js (VERSÃO BLINDADA CONTRA LOADING INFINITO E COM PAINEL DO CAIXA ATUALIZADO)

const App = {
    userProfile: null,
    initialized: false,
    dashboardChannel: null,
    modules: {
        usuarios: UsuariosModule,
        comprovantes: ComprovantesModule,
        creditos: CreditosModule,
        solicitacoes: SolicitacoesModule
    },
    moduleConfig: [
        { key: 'comprovantes', name: 'Comprovantes', permissionCheck: (user) => user.permissions?.comprovantes?.view },
        { key: 'creditos', name: 'Créditos', permissionCheck: (user) => user.permissions?.creditos?.view },
        { key: 'solicitacoes', name: 'Solicitações D/C', permissionCheck: (user) => user.permissions?.solicitacoes?.view && user.permissions.solicitacoes.view !== 'none' },
        { key: 'usuarios', name: 'Usuários', permissionCheck: (user) => user.is_admin }
    ],

    isInitialized() {
        return this.initialized;
    },

    init(userProfile) {
        if (this.initialized) return;
        this.userProfile = userProfile;
        this.initialized = true;
        console.log("Aplicação iniciada com o perfil:", userProfile);
        this.renderLayout();
        this.setupEventListeners();
        this.renderHome();
    },

    destroy() {
        this.unsubscribeFromDashboardChanges();
        this.userProfile = null;
        this.initialized = false;
        console.log("Estado da aplicação limpo.");
    },

    renderLayout() {
        document.getElementById('user-display-name').textContent = this.userProfile.full_name || this.userProfile.username;
        this.buildNavigation();
    },

    buildNavigation() {
        const nav = document.getElementById('main-nav');
        let navHtml = '<ul>';
        navHtml += `<li><a href="#" data-module="home" class="nav-link active">Início</a></li>`;
        this.moduleConfig.forEach(config => {
            if (config.permissionCheck(this.userProfile)) {
                navHtml += `<li><a href="#" data-module="${config.key}" class="nav-link">${config.name}</a></li>`;
            }
        });
        navHtml += '</ul>';
        nav.innerHTML = navHtml;
    },

    async loadModule(moduleName, initialFilters = null) {
        this.unsubscribeFromDashboardChanges();
        this.showLoader();
        try {
            const module = this.modules[moduleName];
            const moduleConf = this.moduleConfig.find(m => m.key === moduleName);
            document.getElementById('header-title').textContent = moduleConf?.name || 'Módulo';
            if (module && typeof module.render === 'function') {
                await module.render(initialFilters);
            } else {
                console.warn(`Módulo "${moduleName}" não implementado ou não encontrado.`);
                document.getElementById('content-area').innerHTML = `<div class="card"><p>O módulo <strong>${moduleConf.name}</strong> está em desenvolvimento.</p></div>`;
            }
        } catch (error) {
            console.error(`Erro ao renderizar o módulo ${moduleName}:`, error);
            document.getElementById('content-area').innerHTML = `<div class="card error-message">Ocorreu um erro grave ao carregar este módulo.</div>`;
        } finally {
            this.hideLoader();
        }
    },

    navigateToModule(moduleName, filters) {
        const navLink = document.querySelector(`#main-nav a[data-module="${moduleName}"]`);
        if (navLink) {
            document.querySelectorAll('#main-nav .nav-link').forEach(link => link.classList.remove('active'));
            navLink.classList.add('active');
            this.loadModule(moduleName, filters);
        }
    },

    async renderHome() {
        this.showLoader();
        document.getElementById('header-title').textContent = 'Início';
        try {
            const contentArea = document.getElementById('content-area');
            const userRoles = this.userProfile.roles || [];

            const canManageWidgets = this.userProfile.permissions?.home?.manage_widgets;
            let managementButtonHtml = canManageWidgets 
                ? `<button id="btn-manage-widgets" class="btn btn-secondary">Gerenciar Avisos e Links</button>` 
                : '';

            let dashboardHtml = `
                <div class="card" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2>Bem-vindo, ${this.userProfile.full_name}!</h2>
                    ${managementButtonHtml}
                </div>`;
            
            // <<< NOVO: Card de Formulários no topo >>>
            const canViewAllCredits = this.userProfile.permissions?.creditos?.view === 'all';
            if (canViewAllCredits) {
                dashboardHtml += `
                    <div class="dashboard-section" id="card-formularios">
                        <h3>Formulários</h3>
                        <div class="dashboard-grid">
                            <div class="card quick-action-card">
                                <button id="btn-form-segunda-via" class="btn btn-primary">Segunda via</button>
                                <button id="btn-form-catalogo" class="btn btn-primary">Catálogo</button>
                                <button id="btn-form-brindes" class="btn btn-primary">Brindes/Bonificação</button>
                                <button id="btn-form-romaneio" class="btn btn-primary">Romaneio</button>
                            </div>
                        </div>
                    </div>
                `;
            }

            const roleRenderers = {
                'VENDEDOR': this._renderVendedorDashboard,
                'CAIXA': this._renderCaixaDashboard,
                'FINANCEIRO': this._renderFinanceiroDashboard,
                'FATURISTA': this._renderFaturistaDashboard,
                'GARANTIA': this._renderGarantiaDashboard,
            };

            let renderedSections = new Set();
            for (const role of userRoles) {
                if (roleRenderers[role] && !renderedSections.has(role)) {
                    dashboardHtml += await roleRenderers[role].call(this);
                    renderedSections.add(role);
                }
            }

            if (renderedSections.size === 0 && !canManageWidgets && !canViewAllCredits) {
                dashboardHtml += '<div class="card"><p>Você não possui uma função com dashboard definido.</p></div>';
            }

            contentArea.innerHTML = dashboardHtml;
            this.setupHomeEventListeners();
            this.updateDashboardStats();
            this.subscribeToDashboardChanges();
        } catch (error) {
            console.error("Erro grave ao renderizar a Home:", error);
            document.getElementById('content-area').innerHTML = `<div class="card error-message">Ocorreu um erro ao carregar o painel inicial. Tente novamente mais tarde.</div>`;
        } finally {
            this.hideLoader();
        }
    },
    
    async _renderVendedorDashboard() {
        const { data: avisos } = await supabase.from('avisos').select('content').eq('is_active', true).gt('expires_at', new Date().toISOString());
        const avisosHtml = avisos && avisos.length > 0 ? `<ul>${avisos.map(a => `<li>${a.content}</li>`).join('')}</ul>` : '<p>Nenhum aviso no momento.</p>';

        const canViewSolicitacoes = this.userProfile.permissions?.solicitacoes?.view && this.userProfile.permissions.solicitacoes.view !== 'none';
        const canCreateSolicitacoes = this.userProfile.permissions?.solicitacoes?.create;

        return `
            <div class="dashboard-section">
                <div class="dashboard-grid">
                    <div class="card avisos-card"><h3>Avisos</h3>${avisosHtml}</div>

                    <div class="card quick-action-card">
                        <h3>Ações Rápidas</h3>
                        <button class="btn btn-primary home-add-proof">Adicionar Comprovante</button>
                        ${canCreateSolicitacoes ? '<button id="home-add-solicitacao" class="btn btn-secondary">Nova Solicitação D/C</button>' : ''}
                        <button id="home-show-links" class="btn btn-info">Links Úteis</button>
                    </div>
                    <div class="card search-card">
                        <h3>Consultar Créditos</h3>
                        <div class="form-group">
                            <label for="home-search-credit-input-vendedor">Código do Cliente</label>
                            <input type="text" class="home-search-credit-input" id="home-search-credit-input-vendedor" placeholder="Digite o código">
                        </div>
                        <button class="btn btn-secondary home-search-credit-btn">Buscar</button>
                    </div>
                    <div id="widget-vendedor-creditos-card" class="card stat-card is-info">
                        <div id="widget-vendedor-creditos-count" class="stat-number">--</div>
                        <div class="stat-label">Clientes com Crédito</div>
                    </div>
                    ${canViewSolicitacoes ? `
                        <div id="widget-vendedor-solicitacoes-card" class="card stat-card is-warning">
                            <div id="widget-vendedor-solicitacoes-count" class="stat-number">--</div>
                            <div class="stat-label">Solicitações Pendentes</div>
                        </div>
                    ` : ''}
                </div>
            </div>`;
    },

    // <<< FUNÇÃO ATUALIZADA >>>
    _renderCaixaDashboard() {
        // Verifica se o usuário tem permissão para ver o módulo de solicitações
        const canViewSolicitacoes = this.userProfile.permissions?.solicitacoes?.view && this.userProfile.permissions.solicitacoes.view !== 'none';

        return `
            <div class="dashboard-section">
                <h3>Painel do Caixa</h3>
                <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
                    <div class="card quick-action-card">
                         <button class="btn btn-primary home-add-proof">Inserir Novo Pagamento</button>
                    </div>
                    <div id="widget-faturado" class="card stat-card is-success" data-status-filter="FATURADO">
                        <div id="widget-faturado-count" class="stat-number">...</div>
                        <div class="stat-label">Pagamentos Prontos para Baixa</div>
                    </div>
                    ${canViewSolicitacoes ? `
                    <div id="widget-caixa-solicitacoes-card" class="card stat-card is-warning">
                        <div id="widget-caixa-solicitacoes-count" class="stat-number">--</div>
                        <div class="stat-label">Solicitações D/C Pendentes</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    _renderFinanceiroDashboard() {
        return `
            <div class="dashboard-section">
                <h3>Painel Financeiro</h3>
                <div class="dashboard-grid">
                    <div id="widget-pending" class="card stat-card is-warning" data-status-filter="AGUARDANDO CONFIRMAÇÃO">
                        <div id="widget-pending-count" class="stat-number">...</div>
                        <div class="stat-label">Pagamentos Aguardando Confirmação</div>
                    </div>
                </div>
            </div>
        `;
    },

    _renderFaturistaDashboard() {
        return `
            <div class="dashboard-section">
                <h3>Painel do Faturista</h3>
                <div class="dashboard-grid">
                     <div class="card quick-action-card"><button class="btn btn-primary home-add-credit">Inserir Novo Crédito</button></div>
                    <div class="card search-card">
                        <h3>Consultar Créditos</h3>
                        <div class="form-group">
                            <label for="faturista-client-code">Código do Cliente</label>
                            <input type="text" class="home-search-credit-input" id="faturista-client-code" placeholder="Digite o código">
                        </div>
                        <button class="btn btn-secondary home-search-credit-btn">Buscar</button>
                    </div>
                    <div id="widget-confirmed" class="card stat-card is-info" data-status-filter="CONFIRMADO"><div id="widget-confirmed-count" class="stat-number">...</div><div class="stat-label">Pagamentos Confirmados para Faturar</div></div>
                </div>
            </div>`;
    },

    _renderGarantiaDashboard() {
        return `
            <div class="dashboard-section">
                <h3>Painel da Garantia</h3>
                <div class="dashboard-grid">
                    <div class="card quick-action-card"><button class="btn btn-primary home-add-credit">Inserir Novo Crédito</button></div>
                    <div class="card search-card">
                        <h3>Consultar Créditos</h3>
                        <div class="form-group">
                            <label for="garantia-client-code">Código do Cliente</label>
                            <input type="text" class="home-search-credit-input" id="garantia-client-code" placeholder="Digite o código">
                        </div>
                        <button class="btn btn-secondary home-search-credit-btn">Buscar</button>
                    </div>
                </div>
            </div>`;
    },

    setupHomeEventListeners() {
        const contentArea = document.getElementById('content-area');
        
        // Listeners existentes...
        contentArea.querySelectorAll('.home-add-proof').forEach(button => {
            button.addEventListener('click', () => this.modules.comprovantes.renderProofModal());
        });

        contentArea.querySelectorAll('.home-add-credit').forEach(button => {
            button.addEventListener('click', () => this.modules.creditos.renderCreditModal());
        });

        const addSolicitacaoBtn = contentArea.querySelector('#home-add-solicitacao');
        if (addSolicitacaoBtn) addSolicitacaoBtn.addEventListener('click', () => this.modules.solicitacoes.renderRequestModal());

        contentArea.querySelectorAll('.home-search-credit-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const searchCard = e.target.closest('.search-card');
                if (searchCard) {
                    const input = searchCard.querySelector('.home-search-credit-input');
                    if (input.value) this.navigateToModule('creditos', { client_code: input.value, status: 'Disponível' });
                }
            });
        });
        
        const showLinksBtn = contentArea.querySelector('#home-show-links');
        if (showLinksBtn) {
            showLinksBtn.addEventListener('click', async () => {
                const { data: links } = await supabase.from('links_uteis').select('*').order('display_order');
                const modalBody = document.getElementById('modal-body');
                if(links && links.length > 0) {
                    modalBody.innerHTML = `<h2>Links Úteis</h2><div id="links-uteis-list">${links.map(l => `<a href="${l.url}" target="_blank">${l.title}</a>`).join('')}</div>`;
                } else {
                    modalBody.innerHTML = `<h2>Links Úteis</h2><p>Nenhum link cadastrado.</p>`;
                }
                document.getElementById('modal-container').classList.add('active');
            });
        }

        contentArea.querySelectorAll('.stat-card[data-status-filter]').forEach(card => {
            card.addEventListener('click', () => this.navigateToModule('comprovantes', { status: card.dataset.statusFilter }));
        });

        const manageWidgetsBtn = contentArea.querySelector('#btn-manage-widgets');
        if (manageWidgetsBtn) manageWidgetsBtn.addEventListener('click', () => this.renderManagementModal());

        const creditStatCard = contentArea.querySelector('#widget-vendedor-creditos-card');
        if (creditStatCard) {
            creditStatCard.addEventListener('click', () => {
                if (this.userProfile.seller_id_erp) this.navigateToModule('creditos', { seller_id: this.userProfile.seller_id_erp, status: 'Disponível' });
            });
        }

        const solicitacoesStatCard = contentArea.querySelector('#widget-vendedor-solicitacoes-card');
        if (solicitacoesStatCard) solicitacoesStatCard.addEventListener('click', () => this.navigateToModule('solicitacoes', { status: 'PENDENTE' }));

        const solicitacoesCaixaCard = contentArea.querySelector('#widget-caixa-solicitacoes-card');
        if (solicitacoesCaixaCard) solicitacoesCaixaCard.addEventListener('click', () => this.navigateToModule('solicitacoes', { status: 'PENDENTE' }));

        // <<< NOVOS LISTENERS PARA OS FORMULÁRIOS >>>
        const btnSegundaVia = contentArea.querySelector('#btn-form-segunda-via');
        if (btnSegundaVia) btnSegundaVia.addEventListener('click', () => this.renderModalSegundaVia());

        const btnCatalogo = contentArea.querySelector('#btn-form-catalogo');
        if (btnCatalogo) btnCatalogo.addEventListener('click', () => this.renderModalCatalogo());

        const btnBrindes = contentArea.querySelector('#btn-form-brindes');
        if (btnBrindes) btnBrindes.addEventListener('click', () => this.renderModalBrindes());

        const btnRomaneio = contentArea.querySelector('#btn-form-romaneio');
        if (btnRomaneio) btnRomaneio.addEventListener('click', () => this.renderModalRomaneio());
    },

    async renderManagementModal() {
        this.showLoader();
        const modalBody = document.getElementById('modal-body');

        const { data: avisos } = await supabase.from('avisos').select('*').order('created_at', { ascending: false });
        const { data: links } = await supabase.from('links_uteis').select('*').order('display_order');

        modalBody.innerHTML = `
            <h2>Gerenciar Avisos e Links</h2>
            <div class="management-section">
                <h3>Avisos</h3>
                <button class="btn btn-primary btn-sm" data-action="create-aviso">Novo Aviso</button>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Conteúdo</th><th>Expira em</th><th>Ativo</th><th>Ações</th></tr></thead>
                        <tbody>
                            ${avisos.map(a => `
                                <tr data-id="${a.id}">
                                    <td>${a.content.substring(0, 50)}...</td>
                                    <td>${new Date(a.expires_at).toLocaleDateString()}</td>
                                    <td>${a.is_active ? 'Sim' : 'Não'}</td>
                                    <td><button class="btn btn-secondary btn-sm" data-action="edit-aviso">Editar</button></td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="management-section">
                <h3>Links Úteis</h3>
                <button class="btn btn-primary btn-sm" data-action="create-link">Novo Link</button>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Título</th><th>URL</th><th>Ordem</th><th>Ações</th></tr></thead>
                        <tbody>
                            ${links.map(l => `
                                <tr data-id="${l.id}">
                                    <td>${l.title}</td>
                                    <td>${l.url.substring(0, 30)}...</td>
                                    <td>${l.display_order}</td>
                                    <td><button class="btn btn-secondary btn-sm" data-action="edit-link">Editar</button></td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        this.hideLoader();
        document.getElementById('modal-container').classList.add('active');

        modalBody.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            const id = e.target.closest('tr')?.dataset.id;

            if (action === 'create-aviso' || action === 'edit-aviso') {
                const aviso = action === 'edit-aviso' ? avisos.find(a => a.id === id) : null;
                this.renderAvisoForm(aviso);
            }
            if (action === 'create-link' || action === 'edit-link') {
                const link = action === 'edit-link' ? links.find(l => l.id === id) : null;
                this.renderLinkForm(link);
            }
        });
    },

    renderAvisoForm(aviso = null) {
        const modalBody = document.getElementById('modal-body');
        const expiresDate = aviso ? new Date(aviso.expires_at).toISOString().split('T')[0] : '';
        modalBody.innerHTML = `
            <h2>${aviso ? 'Editar' : 'Novo'} Aviso</h2>
            <form id="aviso-form">
                <input type="hidden" id="avisoId" value="${aviso?.id || ''}">
                <div class="form-group">
                    <label for="avisoContent">Conteúdo</label>
                    <textarea id="avisoContent" required>${aviso?.content || ''}</textarea>
                </div>
                <div class="form-group">
                    <label for="avisoExpires">Data de Expiração</label>
                    <input type="date" id="avisoExpires" value="${expiresDate}" required>
                </div>
                <div class="form-group">
                    <input type="checkbox" id="avisoActive" ${aviso?.is_active ?? true ? 'checked' : ''}>
                    <label for="avisoActive">Ativo</label>
                </div>
                <button type="submit" class="btn btn-primary">Salvar</button>
                <button type="button" class="btn btn-secondary" id="back-to-management">Voltar</button>
            </form>
        `;
        document.getElementById('aviso-form').addEventListener('submit', this.handleAvisoSubmit.bind(this));
        document.getElementById('back-to-management').addEventListener('click', () => this.renderManagementModal());
    },

    async handleAvisoSubmit(e) {
        e.preventDefault();
        this.showLoader();
        const form = e.target;
        const data = {
            content: form.avisoContent.value,
            expires_at: form.avisoExpires.value,
            is_active: form.avisoActive.checked
        };
        const id = form.avisoId.value;
        const { error } = id
            ? await supabase.from('avisos').update(data).eq('id', id)
            : await supabase.from('avisos').insert(data);

        if (error) {
            alert('Erro ao salvar aviso: ' + error.message);
        } else {
            await this.renderManagementModal();
            this.renderHome();
        }
        this.hideLoader();
    },

    renderLinkForm(link = null) {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h2>${link ? 'Editar' : 'Novo'} Link Útil</h2>
            <form id="link-form">
                <input type="hidden" id="linkId" value="${link?.id || ''}">
                <div class="form-group">
                    <label for="linkTitle">Título</label>
                    <input type="text" id="linkTitle" value="${link?.title || ''}" required>
                </div>
                <div class="form-group">
                    <label for="linkUrl">URL</label>
                    <input type="url" id="linkUrl" value="${link?.url || ''}" required>
                </div>
                <div class="form-group">
                    <label for="linkOrder">Ordem de Exibição</label>
                    <input type="number" id="linkOrder" value="${link?.display_order || 0}" required>
                </div>
                <button type="submit" class="btn btn-primary">Salvar</button>
                <button type="button" class="btn btn-secondary" id="back-to-management">Voltar</button>
            </form>
        `;
        document.getElementById('link-form').addEventListener('submit', this.handleLinkSubmit.bind(this));
        document.getElementById('back-to-management').addEventListener('click', () => this.renderManagementModal());
    },

    async handleLinkSubmit(e) {
        e.preventDefault();
        this.showLoader();
        const form = e.target;
        const data = {
            title: form.linkTitle.value,
            url: form.linkUrl.value,
            display_order: parseInt(form.linkOrder.value)
        };
        const id = form.linkId.value;
        const { error } = id
            ? await supabase.from('links_uteis').update(data).eq('id', id)
            : await supabase.from('links_uteis').insert(data);

        if (error) {
            alert('Erro ao salvar link: ' + error.message);
        } else {
            await this.renderManagementModal();
        }
        this.hideLoader();
    },

    // <<< FUNÇÃO ATUALIZADA >>>
    async updateDashboardStats() {
        const { data, error } = await supabase.rpc('get_dashboard_stats');
        if (error) {
            console.error("Erro ao buscar estatísticas do dashboard:", error);
        } else if (data) {
            const pendingEl = document.getElementById('widget-pending-count');
            if (pendingEl) pendingEl.textContent = data.pending_proofs;
            const confirmedEl = document.getElementById('widget-confirmed-count');
            if (confirmedEl) confirmedEl.textContent = data.confirmed_proofs;
            const faturadoEl = document.getElementById('widget-faturado-count');
            if (faturadoEl) faturadoEl.textContent = data.faturado_proofs;
        }

        if (this.userProfile.roles.includes('VENDEDOR') && this.userProfile.seller_id_erp) {
            const creditCountEl = document.getElementById('widget-vendedor-creditos-count');
            if (creditCountEl) {
                const { data: creditData, error: creditError } = await supabase.rpc('get_vendedor_credit_stats', {
                    p_seller_id: this.userProfile.seller_id_erp
                });
                creditCountEl.textContent = creditError ? 'Erro' : creditData;
            }

            const solicitacoesCountEl = document.getElementById('widget-vendedor-solicitacoes-count');
            if (solicitacoesCountEl) {
                const { data: reqData, error: reqError } = await supabase.rpc('get_vendedor_pending_requests_count', {
                    p_requester_id: this.userProfile.id
                });
                solicitacoesCountEl.textContent = reqError ? 'Erro' : reqData;
            }
        }

        // <<< LÓGICA ADICIONADA PARA BUSCAR STATS DO NOVO CARD DO CAIXA >>>
        if (this.userProfile.roles.includes('CAIXA')) {
            const solicitacoesCaixaCountEl = document.getElementById('widget-caixa-solicitacoes-count');
            if (solicitacoesCaixaCountEl) {
                const { data, error } = await supabase.rpc('get_all_pending_requests_count');
                solicitacoesCaixaCountEl.textContent = error ? 'Erro' : data;
            }
        }
    },

    subscribeToDashboardChanges() {
        if (this.dashboardChannel) return;
        
        const handleDbChange = (payload) => {
            console.log('Mudança no banco de dados detectada:', payload.table);
            this.updateDashboardStats();
        };

        this.dashboardChannel = supabase
            .channel('dashboard-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'proofs' }, handleDbChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'credits' }, handleDbChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'dc_requests' }, handleDbChange)
            .subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Conectado ao canal de realtime do dashboard!');
                }
                if (err) {
                    console.error('Erro na inscrição do canal de realtime:', err);
                }
            });
    },

    unsubscribeFromDashboardChanges() {
        if (this.dashboardChannel) {
            supabase.removeChannel(this.dashboardChannel);
            this.dashboardChannel = null;
            console.log('Desconectado do canal de realtime do dashboard.');
        }
    },

    setupEventListeners() {
        const sidebar = document.getElementById('sidebar');
        const menuToggle = document.getElementById('menu-toggle');
        const sidebarOverlay = document.getElementById('sidebar-overlay');

        menuToggle.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                sidebar.classList.toggle('collapsed');
            } else {
                sidebar.classList.toggle('active');
            }
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
        });

        document.getElementById('main-nav').addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.classList.contains('nav-link')) {
                e.preventDefault();
                
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('active');
                }

                document.querySelectorAll('#main-nav .nav-link').forEach(link => link.classList.remove('active'));
                e.target.classList.add('active');
                const moduleName = e.target.dataset.module;
                if (moduleName === 'home') this.renderHome();
                else this.loadModule(moduleName);
            }
        });

        const modalContainer = document.getElementById('modal-container');
        modalContainer.addEventListener('click', (e) => {
            if (e.target === modalContainer || e.target.classList.contains('modal-close-btn')) {
                if (this.modules.comprovantes && typeof this.modules.comprovantes.cleanupModalListeners === 'function') {
                    this.modules.comprovantes.cleanupModalListeners();
                }
                modalContainer.classList.remove('active');
            }
        });
    },

    showLoader() { document.getElementById('loader').classList.add('active'); },
    hideLoader() { document.getElementById('loader').classList.remove('active'); },

    // ==========================================
    // MÉTODOS PARA OS FORMULÁRIOS DO DASHBOARD
    // ==========================================

    async submitFormularioDashboard(endpoint, payload) {
        this.showLoader();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos

            // NOTA DE SEGURANÇA: Aqui você aponta para sua API Vercel (ex: /api/segunda-via)
            // que então redirecionará para o webhook real de forma segura.
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`Falha na comunicação (Status: ${response.status})`);

            const htmlContent = await response.text();

            // Abre o retorno HTML em uma nova aba
            const newWindow = window.open('', '_blank');
            if (newWindow) {
                newWindow.document.write(htmlContent);
                newWindow.document.close();
            } else {
                alert('Aviso: O pop-up foi bloqueado pelo seu navegador. Por favor, permita pop-ups para este site.');
            }

            document.getElementById('modal-container').classList.remove('active');
        } catch (error) {
            if (error.name === 'AbortError') {
                alert('Tempo limite de 90 segundos excedido. O servidor demorou muito para responder.');
            } else {
                alert('Erro ao processar a solicitação: ' + error.message);
            }
        } finally {
            this.hideLoader();
        }
    },

    renderModalSegundaVia() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h2>Segunda via</h2>
            <form id="form-segunda-via">
                <div class="form-group">
                    <label>Código do Cliente *</label>
                    <input type="text" id="sv-cod-cliente" required>
                </div>
                <div class="form-group">
                    <label>Tipo *</label>
                    <select id="sv-tipo" required>
                        <option value="">Selecione...</option>
                        <option value="BOLETOS VENCIDOS">BOLETOS VENCIDOS</option>
                        <option value="BOLETOS A VENCER">BOLETOS A VENCER</option>
                        <option value="TODOS OS BOLETOS">TODOS OS BOLETOS</option>
                        <option value="ESPELHO + BOL">ESPELHO + BOL</option>
                        <option value="PEDIDOS RECENTES">PEDIDOS RECENTES</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Código do Pedido <span id="sv-pedido-req" style="display:none; color:red;">*</span></label>
                    <input type="text" id="sv-cod-pedido">
                </div>
                <button type="submit" class="btn btn-primary">Gerar Relatório</button>
            </form>
        `;
        document.getElementById('modal-container').classList.add('active');

        const tipoSelect = document.getElementById('sv-tipo');
        const pedidoInput = document.getElementById('sv-cod-pedido');
        const pedidoReq = document.getElementById('sv-pedido-req');

        tipoSelect.addEventListener('change', () => {
            if (tipoSelect.value === 'ESPELHO + BOL') {
                pedidoInput.required = true;
                pedidoReq.style.display = 'inline';
            } else {
                pedidoInput.required = false;
                pedidoReq.style.display = 'none';
            }
        });

        document.getElementById('form-segunda-via').addEventListener('submit', (e) => {
            e.preventDefault();
            const payload = {
                codigo_cliente: document.getElementById('sv-cod-cliente').value,
                tipo: tipoSelect.value,
                codigo_pedido: pedidoInput.value || null
            };
            this.submitFormularioDashboard('/api/segunda-via', payload); // Altere para seu endpoint seguro
        });
    },

    renderModalCatalogo() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h2>Catálogo</h2>
            <form id="form-catalogo">
                <div class="form-group">
                    <label>Tabela *</label>
                    <select id="cat-tabela" required>
                        <option value="">Selecione...</option>
                        <option value="Oportunidades">Oportunidades</option>
                        <option value="Geral">Geral</option>
                        <option value="Bonificação">Bonificação</option>
                        <option value="Específica">Específica</option>
                    </select>
                </div>
                
                <div id="cat-cond-oportunidades" class="conditional-field">
                    <label>Opções de Oportunidades (Selecione uma ou mais):</label>
                    <select id="cat-oportunidades-list" multiple size="6" class="form-control">
                        <option value="TOP 80">TOP 80</option>
                        <option value="PNEUS">PNEUS</option>
                        <option value="MAQUINAS & FERRAMENTAS">MAQUINAS & FERRAMENTAS</option>
                        <option value="DANMA & OUMURS">DANMA & OUMURS</option>
                        <option value="HONDA">HONDA</option>
                        <option value="ESCALONADA">ESCALONADA</option>
                    </select>
                    <small>Segure Ctrl (ou Cmd) para selecionar várias.</small>
                </div>

                <div id="cat-cond-especifica" class="conditional-field">
                    <div class="form-group">
                        <label>Filtro Específico</label>
                        <select id="cat-esp-filtro">
                            <option value="">Selecione...</option>
                            <option value="Grupo">Grupo</option>
                            <option value="Linha">Linha</option>
                            <option value="Marca">Marca</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Códigos Específicos (separados por vírgula)</label>
                        <input type="text" id="cat-esp-codigos" placeholder="Ex: 154, 321, 454">
                    </div>
                </div>

                <button type="submit" class="btn btn-primary" style="margin-top: 1rem;">Gerar Catálogo</button>
            </form>
        `;
        document.getElementById('modal-container').classList.add('active');

        const tabelaSelect = document.getElementById('cat-tabela');
        const condOportunidades = document.getElementById('cat-cond-oportunidades');
        const condEspecifica = document.getElementById('cat-cond-especifica');
        const opList = document.getElementById('cat-oportunidades-list');
        const espFiltro = document.getElementById('cat-esp-filtro');
        const espCodigos = document.getElementById('cat-esp-codigos');

        tabelaSelect.addEventListener('change', () => {
            condOportunidades.classList.remove('active');
            condEspecifica.classList.remove('active');
            opList.required = false;
            espCodigos.required = false;

            if (tabelaSelect.value === 'Oportunidades') {
                condOportunidades.classList.add('active');
                opList.required = true;
            } else if (tabelaSelect.value === 'Específica') {
                condEspecifica.classList.add('active');
                espCodigos.required = true;
            }
        });

        document.getElementById('form-catalogo').addEventListener('submit', (e) => {
            e.preventDefault();
            let payload = { tabela: tabelaSelect.value };

            if (tabelaSelect.value === 'Oportunidades') {
                payload.oportunidades = Array.from(opList.selectedOptions).map(opt => opt.value);
            } else if (tabelaSelect.value === 'Específica') {
                payload.especifica_filtro = espFiltro.value;
                payload.especifica_codigos = espCodigos.value;
            }

            this.submitFormularioDashboard('/api/catalogo', payload); // Altere para seu endpoint seguro
        });
    },

    renderModalBrindes() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h2>Brindes/Bonificação</h2>
            <div class="form-info-text">
                <strong>REGRAS DA BONIFICAÇÃO</strong><br><br>
                Compra mínima de R$ 3.000,00 em itens VIPAL: Bonificação de 3% sobre o valor total dos produtos VIPAL.<br><br>
                Compra mínima de R$ 5.000,00 em itens VIPAL: Bonificação de 5% sobre o valor total dos produtos VIPAL.
            </div>
            <form id="form-brindes">
                <div class="form-group">
                    <label>Tipo *</label>
                    <select id="bb-tipo" required>
                        <option value="">Selecione...</option>
                        <option value="BRINDE">BRINDE</option>
                        <option value="BONIFICAÇÃO">BONIFICAÇÃO</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>idVN *</label>
                    <input type="number" id="bb-idvn" required>
                </div>
                <div class="form-group">
                    <label>idVA *</label>
                    <input type="number" id="bb-idva" required>
                </div>
                <button type="submit" class="btn btn-primary">Processar Solicitação</button>
            </form>
        `;
        document.getElementById('modal-container').classList.add('active');

        document.getElementById('form-brindes').addEventListener('submit', (e) => {
            e.preventDefault();
            const payload = {
                tipo: document.getElementById('bb-tipo').value,
                idVN: Number(document.getElementById('bb-idvn').value),
                idVA: Number(document.getElementById('bb-idva').value)
            };
            this.submitFormularioDashboard('/api/brindes-bonificacao', payload); // Altere para seu endpoint seguro
        });
    },

    renderModalRomaneio() {
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h2>Romaneio</h2>
            <form id="form-romaneio">
                <div class="form-group">
                    <label>Data Inicial *</label>
                    <input type="date" id="rom-data-inicial" required>
                </div>
                <div class="form-group">
                    <label>Data Final *</label>
                    <input type="date" id="rom-data-final" required>
                </div>
                <div class="form-group">
                    <label>Opção de Romaneio *</label>
                    <select id="rom-opcao" required>
                        <option value="">Selecione...</option>
                        <option value="Todos">Todos</option>
                        <option value="Com Romaneio">Com Romaneio</option>
                        <option value="Sem Romaneio">Sem Romaneio</option>
                        <option value="Romaneios Específicos">Romaneios Específicos</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Vendedores (opcional)</label>
                    <input type="text" id="rom-vendedores" placeholder="Ex: João, Maria">
                </div>
                <div class="form-group">
                    <label>Rotas (opcional)</label>
                    <input type="text" id="rom-rotas" placeholder="Ex: Rota A, Rota B">
                </div>
                <div id="rom-cond-especifico" class="conditional-field">
                    <label>Código dos Romaneios</label>
                    <input type="text" id="rom-codigos" placeholder="Ex: 12345, 67890">
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top: 1rem;">Gerar Romaneio</button>
            </form>
        `;
        document.getElementById('modal-container').classList.add('active');

        const opcaoSelect = document.getElementById('rom-opcao');
        const condEspecifico = document.getElementById('rom-cond-especifico');

        opcaoSelect.addEventListener('change', () => {
            if (opcaoSelect.value === 'Romaneios Específicos') {
                condEspecifico.classList.add('active');
            } else {
                condEspecifico.classList.remove('active');
                document.getElementById('rom-codigos').value = '';
            }
        });

        document.getElementById('form-romaneio').addEventListener('submit', (e) => {
            e.preventDefault();
            const payload = {
                data_inicial: document.getElementById('rom-data-inicial').value,
                data_final: document.getElementById('rom-data-final').value,
                romaneio_opcao: opcaoSelect.value,
                vendedores: document.getElementById('rom-vendedores').value || null,
                rotas: document.getElementById('rom-rotas').value || null,
                codigo_romaneios: document.getElementById('rom-codigos').value || null
            };
            this.submitFormularioDashboard('/api/romaneio', payload); // Altere para seu endpoint seguro
        });
    }
};
