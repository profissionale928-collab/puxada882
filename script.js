// Configurações da API
const API_BASE_URL = 'https://api.cnpja.com/office';
const API_KEY = 'af0d74dc-d8a3-4856-8544-2db5d9f8996c-47890af6-6e64-4110-b390-ee988e8eed38';

// Elementos do DOM
const searchForm = document.getElementById('searchForm' );
const dataInicio = document.getElementById('dataInicio');
const dataFim = document.getElementById('dataFim');
const loadingSpinner = document.getElementById('loadingSpinner');
const errorMessage = document.getElementById('errorMessage');
const debugInfo = document.getElementById('debugInfo');
const requestUrlSpan = document.getElementById('requestUrl');
const apiResponseSpan = document.getElementById('apiResponse');
const resultsContainer = document.getElementById('resultsContainer');
const noResults = document.getElementById('noResults');
const tableBody = document.getElementById('tableBody');
const resultCount = document.getElementById('resultCount');
const btnSearch = document.querySelector('.btn-search');
const btnExportEmails = document.getElementById('btnExportEmails');
const btnExportPhones = document.getElementById('btnExportPhones');
const btnExportManychat = document.getElementById('btnExportManychat'); // Novo botão

// Variável global para armazenar todos os resultados
let filteredResults = [];

// Função para filtrar resultados com base no padrão **.***.*** antes do nome
function filterByRazaoSocialPattern(results) {
    // Regex para o padrão: XX.XXX.XXX (pode ser mais flexível com \d ou \w)
    // Usando \d para dígitos, mas permitindo outros caracteres que possam estar no início.
    // O padrão mais seguro é: (dígitos/caracteres).(dígitos/caracteres).(dígitos/caracteres) seguido por espaço.
    // O exemplo é 56.190.792 YAGO CID GARCIA.
    // Regex: ^\d{2}\.\d{3}\.\d{3}\s
    const pattern = /^\d{2}\.\d{3}\.\d{3}\s/;
    
    return results.filter(empresa => {
        const razaoSocial = empresa.company?.name || '';
        return pattern.test(razaoSocial);
    });
}
let allResults = [];

// Função principal de busca
async function handleSearch(e) {
    e.preventDefault();

    // Validação de datas
    const inicio = new Date(dataInicio.value);
    const fim = new Date(dataFim.value);

    if (inicio > fim) {
        showError('A data de início não pode ser maior que a data de fim.');
        return;
    }

    // Limpar resultados anteriores
    clearResults();
    allResults = []; // Limpa resultados globais
    
    // Ocultar debug
    debugInfo.classList.add('hidden');

    // Mostrar spinner de carregamento
    showLoading(true);
    btnSearch.disabled = true;

    try {
        // Formatar datas para ISO 8601, ajustando para incluir o horário para precisão.
        const dataInicioISO = `${dataInicio.value}T00:00:00Z`;
        const dataFimISO = `${dataFim.value}T23:59:59Z`;

        // Construir URL com parâmetros, solicitando um limite alto (10000)
        const params = new URLSearchParams({
            'founded.gte': dataInicioISO,
            'founded.lte': dataFimISO,
            'company.simei.optant.eq': 'true', // Filtro MEI reativado
            'limit': '2' // Aumentado o limite para buscar mais resultados
        });

        const url = `${API_BASE_URL}?${params.toString()}`;
        requestUrlSpan.textContent = url;
        debugInfo.classList.remove('hidden');

        // Fazer requisição à API
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            apiResponseSpan.textContent = `Status: ${response.status}. Resposta: ${errorText}`;
            throw new Error(`Erro na API: ${response.status} - ${response.statusText}. Detalhes no console e na seção de debug.`);
        }

        const data = await response.json();
        apiResponseSpan.textContent = JSON.stringify(data, null, 2).substring(0, 500) + '...'; // Limita o tamanho do log

        // Processar resultados
        if (data.records && data.records.length > 0) {
            // 1. Armazena todos os resultados
            allResults = data.records; 
            
            // 2. Filtra os resultados com base no padrão da Razão Social
            filteredResults = filterByRazaoSocialPattern(allResults);

            // 3. Exibe os resultados filtrados (ou todos, dependendo da intenção original do displayResults)
            // Para manter a funcionalidade original de exibição, vamos exibir todos, mas o export usará o filteredResults
            displayResults(allResults); // Exibe todos os resultados para manter a UI original
            
            // Opcional: Atualizar a contagem para refletir o número de resultados filtrados
            // resultCount.textContent = filteredResults.length;
        } else {
            showNoResults();
        }
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        showError(`Erro ao buscar dados: ${error.message}`);
    } finally {
        showLoading(false);
        btnSearch.disabled = false;
    }
}

// Função de utilidade para extrair o telefone de um registro
function extractPhone(empresa) {
    let phone = 'N/A';
    let phoneData = null;
    let inferredDDD = null;

    // 1. Tenta inferir o DDD a partir do endereço (UF)
    const uf = empresa.address?.state;
    if (uf) {
        inferredDDD = getDDDByState(uf);
    }

    // 2. Tenta extrair o número de telefone de forma mais robusta
    // Lista de possíveis campos de telefone, em ordem de prioridade
    const phoneFields = [
        empresa.company?.phone,
        empresa.phone,
        empresa.phone_alt
    ];

    // 2.1. Prioriza o primeiro telefone do array 'phones' se existir
    if (Array.isArray(empresa.phones) && empresa.phones.length > 0) {
        phoneData = empresa.phones[0];
    } else {
        // 2.2. Busca nos campos de string/objeto
        for (const field of phoneFields) {
            if (field) {
                phoneData = field;
                break;
            }
        }
    }

    // 3. Processa o dado encontrado
    if (typeof phoneData === 'string' && phoneData.trim() !== '') {
        // Se for uma string pura (ex: "11999999999" ou "40787834"), tenta formatar
        phone = formatarTelefone(phoneData, '55', inferredDDD);
    } else if (phoneData && typeof phoneData === 'object') {
        // Se for um objeto (com number/value e area/DDD)
        const number = phoneData.number || phoneData.value;
        const ddd = phoneData.area; // O DDD é o campo 'area' na API cnpja.com
        const countryCode = phoneData.countryCode || '55'; // Usa '55' como padrão se não houver

        // Se o DDD for encontrado na API, ele tem prioridade sobre o DDD inferido pela UF
        const finalDDD = ddd || inferredDDD;

        if (number) {
            // Passa o número, o código do país e o DDD real/inferido para a função de formatação
            phone = formatarTelefone(number, countryCode, finalDDD);
        }
    }
    
    // 4. Fallback: Se a extração falhou, tenta o primeiro item do array 'phones' novamente,
    // caso ele seja um objeto ou string que não foi pego na primeira tentativa.
    if (phone === 'N/A' && Array.isArray(empresa.phones) && empresa.phones.length > 0) {
        const firstPhone = empresa.phones[0];
        if (typeof firstPhone === 'string' && firstPhone.trim() !== '') {
            phone = formatarTelefone(firstPhone, '55', inferredDDD);
        } else if (firstPhone && (firstPhone.number || firstPhone.value)) {
            const ddd = firstPhone.area; // O DDD é o campo 'area' na API cnpja.com
            const countryCode = firstPhone.countryCode || '55';
            const finalDDD = ddd || inferredDDD;
            phone = formatarTelefone(firstPhone.number || firstPhone.value, countryCode, finalDDD);
        }
    }

    return phone;
}

// Função para inferir o DDD a partir da UF (Estado)
function getDDDByState(uf) {
    const dddMap = {
        'AC': '68', 'AL': '82', 'AP': '96', 'AM': '92', 'BA': '71', 'CE': '85', 'DF': '61',
        'ES': '27', 'GO': '62', 'MA': '98', 'MT': '65', 'MS': '67', 'MG': '31', 'PA': '91',
        'PB': '83', 'PR': '41', 'PE': '81', 'PI': '86', 'RJ': '21', 'RN': '84', 'RS': '51',
        'RO': '69', 'RR': '95', 'SC': '48', 'SP': '11', 'SE': '79', 'TO': '63'
    };
    return dddMap[uf.toUpperCase()] || null;
}

// Função de utilidade para extrair o email de um registro
function extractEmail(empresa) {
    let email = 'N/A';
    // Tenta extrair o email de diferentes campos
    const emailData = empresa.company?.email || empresa.emails?.[0] || empresa.email;

    if (typeof emailData === 'string' && emailData.trim() !== '') {
        email = emailData;
    } else if (emailData && typeof emailData === 'object' && (emailData.address || emailData.value)) {
        email = emailData.address || emailData.value;
    } else if (Array.isArray(empresa.emails) && empresa.emails.length > 0) {
        const firstEmail = empresa.emails[0];
        if (typeof firstEmail === 'string' && firstEmail.trim() !== '') {
            email = firstEmail;
        } else if (firstEmail && (firstEmail.address || firstEmail.value)) {
            email = firstEmail.address || firstEmail.value;
        }
    }
    return email;
}

// Função de utilidade para extrair o telefone no formato internacional sem formatação
function extractPhoneRaw(empresa) {
    const phone = extractPhone(empresa);
    // Remove tudo que não for dígito, exceto o '+' inicial
    let raw = phone.replace(/[^\d+]/g, '');
    
    // Se o telefone estiver formatado, ele não terá o código do país.
    // Se não começar com '+55', tenta adicionar o código do país e DDD (se houver)
    if (!raw.startsWith('+55')) {
        // Tenta extrair o DDD do telefone formatado
        const match = phone.match(/\((\d{2})\)/);
        const ddd = match ? match[1] : '';
        
        // Remove a formatação e o DDD para pegar o número puro
        let numeroPuro = phone.replace(/[^\d]/g, '');
        
        // Se o número puro tem 10 ou 11 dígitos (DDD + Número), remove o DDD
        if (numeroPuro.length === 10 || numeroPuro.length === 11) {
            numeroPuro = numeroPuro.substring(2);
        }
        
        // Se o DDD foi encontrado, monta o formato internacional
        if (ddd) {
            raw = `+55${ddd}${numeroPuro}`;
        } else {
            // Se não encontrou DDD, retorna N/A, pois o Manychat precisa do formato internacional
            return 'N/A';
        }
    }
    
    // Se o número tem 14 dígitos (+55 + 2 DDD + 9 dígitos), está correto.
    // Se o número tem 13 dígitos (+55 + 2 DDD + 8 dígitos), está correto.
    if (raw.length === 13 || raw.length === 14) {
        return raw;
    }
    
    return 'N/A';
}

// Função de utilidade para exibir os resultados na tabela (mantida a original)
function displayResults(results) {
    tableBody.innerHTML = '';
    resultCount.textContent = results.length;
    resultsContainer.classList.remove('hidden');
    noResults.classList.add('hidden');

    results.forEach(empresa => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = formatarCNPJ(empresa.taxId || 'N/A');
        row.insertCell().textContent = empresa.company?.name || 'N/A';
        row.insertCell().textContent = formatarData(empresa.founded);
        row.insertCell().textContent = extractEmail(empresa);
        row.insertCell().textContent = extractPhone(empresa);
    });
}

// Função de utilidade para limpar resultados
function clearResults() {
    tableBody.innerHTML = '';
    resultCount.textContent = '0';
    resultsContainer.classList.add('hidden');
    noResults.classList.add('hidden');
    // Ocultar botões de exportar
    document.getElementById('btnExportEmails').classList.add('hidden');
    document.getElementById('btnExportPhones').classList.add('hidden');
    document.getElementById('btnExportManychat').classList.add('hidden');
}

// Função de utilidade para mostrar mensagem de erro
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

// Função de utilidade para mostrar que não há resultados
function showNoResults() {
    noResults.classList.remove('hidden');
    resultsContainer.classList.add('hidden');
    // Ocultar botões de exportar
    document.getElementById('btnExportEmails').classList.add('hidden');
    document.getElementById('btnExportPhones').classList.add('hidden');
    document.getElementById('btnExportManychat').classList.add('hidden');
}

// Função de utilidade para mostrar/ocultar o spinner de carregamento
function showLoading(isLoading) {
    if (isLoading) {
        loadingSpinner.classList.remove('hidden');
        errorMessage.classList.add('hidden');
    } else {
        loadingSpinner.classList.add('hidden');
        // Mostrar botões de exportar se houver resultados
        if (allResults.length > 0) {
            document.getElementById('btnExportEmails').classList.remove('hidden');
            document.getElementById('btnExportPhones').classList.remove('hidden');
            document.getElementById('btnExportManychat').classList.remove('hidden');
        }
    }
}

// Função para exportar apenas emails (mantida a original)
function exportEmails() {
    if (allResults.length === 0) {
        alert('Nenhum resultado para exportar.');
        return;
    }

    const emails = allResults.map(empresa => extractEmail(empresa)).filter(email => email !== 'N/A');
    
    if (emails.length === 0) {
        alert('Nenhum email encontrado para exportar.');
        return;
    }

    const csvContent = emails.join('\n');
    
    // Cria um Blob para download
    const blob = new Blob([csvContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emails_exportados.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Função para exportar apenas telefones (mantida a original)
function exportPhones() {
    if (allResults.length === 0) {
        alert('Nenhum resultado para exportar.');
        return;
    }

    const phones = allResults.map(empresa => extractPhone(empresa)).filter(phone => phone !== 'N/A');
    
    if (phones.length === 0) {
        alert('Nenhum telefone encontrado para exportar.');
        return;
    }

    const csvContent = phones.join('\n');
    
    // Cria um Blob para download
    const blob = new Blob([csvContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'telefones_exportados.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// NOVO: Função para exportar contatos formatados para Manychat
function exportManychatContacts() {
    // Usa os resultados filtrados
    const resultsToExport = filteredResults.length > 0 ? filteredResults : allResults;
    
    if (resultsToExport.length === 0) {
        alert('Nenhum resultado para exportar.');
        return;
    }

    // Cabeçalho do CSV para Manychat
    // phone: Número de telefone no formato internacional (+5511999999999)
    // first_name: Nome da empresa (Razão Social)
    // custom_field_CNPJ: Campo personalizado para o CNPJ
    // custom_field_EMAIL: Campo personalizado para o Email
    // custom_field_DATA_ABERTURA: Campo personalizado para a Data de Abertura
    const header = ['Whatsapp Id', 'First Name', 'Full Name'].join(',');
    
    const dataLines = resultsToExport.map(empresa => {
        const cnpj = empresa.taxId || 'N/A';
        const razaoSocial = empresa.company?.name || 'N/A';
        // Remove a parte inicial que é o CNPJ/números (se houver)
        const namePart = razaoSocial.replace(/^[\d\s\.\/-]+/, '').trim();
        // Pega a primeira palavra do nome e garante que não fique vazia
        const firstName = namePart.split(' ')[0].replace(/[\d.]/g, '').trim() || 'N/A';
        const fullName = razaoSocial.trim();
        const email = extractEmail(empresa);
        // O Manychat requer o telefone no formato internacional sem formatação (+5511999999999)
        const telefoneRaw = extractPhoneRaw(empresa); 
        const dataAbertura = formatarData(empresa.founded);

        // Filtra registros sem telefone válido para o Manychat
        if (telefoneRaw === 'N/A' || !telefoneRaw.startsWith('+55')) {
            return null; // Ignora este registro
        }

// Usa aspas duplas para encapsular campos que podem conter vírgulas (Razão Social)
        return [
            `"${telefoneRaw}"`, // Telefone no formato internacional (agora 'Whatsapp Id')
`"${firstName}"`, // Primeira palavra da Razão Social como First Name
            `"${fullName}"`, // Razão Social completa como Full Name
        ].join(',');
    }).filter(line => line !== null); // Remove os registros ignorados

    if (dataLines.length === 0) {
        alert('Nenhum contato com telefone válido no formato internacional (+55...) encontrado para exportar para o Manychat.');
        return;
    }

    const csvContent = [header, ...dataLines].join('\n');
    
    // Cria um Blob para download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manychat_contacts_filtered.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Funções de formatação
function formatarCNPJ(cnpj) {
    // Remove caracteres não numéricos
    const numLimpo = cnpj.replace(/\D/g, '');
    // Aplica a máscara: XX.XXX.XXX/XXXX-XX
    if (numLimpo.length === 14) {
        return numLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return cnpj;
}

function formatarTelefone(numero, codigoPais = '55', ddd = null) {
    // Remove todos os caracteres não numéricos
    let numLimpo = numero.replace(/\D/g, '');

    // Se o número já começar com o código do país, remove o código do país para formatar
    if (numLimpo.startsWith(codigoPais)) {
        numLimpo = numLimpo.substring(codigoPais.length);
    }

    // Se o DDD foi inferido ou fornecido
    if (ddd) {
        let dddLimpo = ddd.replace(/\D/g, '');
        // Se o número já começar com o DDD, remove o DDD para formatar
        if (numLimpo.startsWith(dddLimpo)) {
            numLimpo = numLimpo.substring(dddLimpo.length);
        }
        // Se o número não tem DDD, adiciona o DDD inferido
        if (numLimpo.length === 8 || numLimpo.length === 9) {
            numLimpo = dddLimpo + numLimpo;
        }
    }

    // Tenta formatar o número
    if (numLimpo.length === 11) { // (XX) 9XXXX-XXXX (com 9º dígito)
        return `(${numLimpo.substring(0, 2)}) ${numLimpo.substring(2, 7)}-${numLimpo.substring(7)}`;
    } else if (numLimpo.length === 10) { // (XX) XXXX-XXXX (sem 9º dígito)
        return `(${numLimpo.substring(0, 2)}) ${numLimpo.substring(2, 6)}-${numLimpo.substring(6)}`;
    } else if (numLimpo.length === 9) { // 9XXXX-XXXX (sem DDD)
        return `${numLimpo.substring(0, 5)}-${numLimpo.substring(5)}`;
    } else if (numLimpo.length === 8) { // XXXX-XXXX (sem DDD e sem 9º dígito)
        return `${numLimpo.substring(0, 4)}-${numLimpo.substring(4)}`;
    }

    return numero; // Retorna o original se não conseguir formatar
}

function formatarData(data) {
    if (!data) return 'N/A';
    try {
        const date = new Date(data);
        return date.toLocaleDateString('pt-BR');
    } catch (error) {
        return data;
    }
}

// Definir data padrão (últimos 6 meses)
function setDefaultDates() {
    const hoje = new Date();
    // Define o período padrão para os últimos 6 meses (aprox. 180 dias)
    const seisMeses = new Date(hoje.getTime() - 180 * 24 * 60 * 60 * 1000);

    dataFim.value = hoje.toISOString().split('T')[0];
    dataInicio.value = seisMeses.toISOString().split('T')[0];
}

// Inicializar com datas padrão
setDefaultDates();

// Event Listeners
searchForm.addEventListener('submit', handleSearch);
// Adiciona os listeners para os botões de exportar
document.addEventListener('click', function(e) {
    if (e.target.id === 'btnExportEmails') {
        exportEmails(); // Chama a função que exporta apenas emails
    } else if (e.target.id === 'btnExportPhones') {
        exportPhones(); // Chama a função que exporta apenas telefones
    } else if (e.target.id === 'btnExportManychat') { // NOVO: Listener para o botão Manychat
        exportManychatContacts();
    }
});

// Ocultar os botões de exportar no início
document.addEventListener('DOMContentLoaded', () => {
    const exportEmailButton = document.getElementById('btnExportEmails');
    const exportPhoneButton = document.getElementById('btnExportPhones');
    const exportManychatButton = document.getElementById('btnExportManychat'); // Novo botão
    if (exportEmailButton) {
        exportEmailButton.classList.add('hidden');
    }
    if (exportPhoneButton) {
        exportPhoneButton.classList.add('hidden');
    }
    if (exportManychatButton) { // Oculta o novo botão
        exportManychatButton.classList.add('hidden');
    }
});
