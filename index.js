import express, { query } from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24
        }

    })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});
db.connect();

///get routes
app.get("/", (req, res) => {
    res.render("home.ejs");
});

app.get("/login", (req, res) => {
    if (req.user) {
        switch (req.user.administrador) {
            case true:
                res.redirect("/admin/home")
                break;
            default:
                res.redirect("/clientes")
                break;
        }

    } else {
        res.render("login.ejs");
    }

});

app.get("/register", (req, res) => {
    res.render("register.ejs")
});

app.get("/redirect", (req, res) => {
    console.log(req.user)
    switch (req.user.administrador) {
        case true:
            res.redirect("/admin/home")
            break;
        default:
            res.redirect("/clientes")
            break;
    }
})

app.get("/admin/:route", async (req, res) => {
    const endPoint = req.params.route;
    const user = await getDbUsers();
    const projetos = await getDbProject();
    const orcamentos = await getDbOrcamentos('Em aberto');
    const etapas = await getDbEtapas()
    const actualUser = req.user
    switch (endPoint) {
        case "usuarios":
            res.render("admin.ejs", { user: user, actualUser: actualUser })
            break;
        case "projetos":
            res.render("admin-projetos.ejs", { projetos: projetos, actualUser: actualUser, usuarios: user, orcamentos: orcamentos });
            break;
        case "edit":
            const id = req.query.id
            let result = await getDbProject(id)
            let projeto = result[0]
            const array = await getDocuments(id)
            const users = user.map((element) => ({ nome: element.nome + " " + element.sobrenome, id: element.id }))
            let etapaProjeto = await getDbEtapas(id)
            res.render("edit.ejs", { projeto: projeto, users: users, documentos: array, etapas: etapaProjeto })
            break;
        case "orcamentos":
            res.render("orcamento.ejs", { actualUser: actualUser, orcamentos: orcamentos })
            break;
        case "home": res.render("admin.ejs", { actualUser: actualUser, etapas: etapas, orcamentos: orcamentos })
            break;
        default:
            res.redirect("/admin/home")
            console.log("Algo de errado com parametros")
    }
})

app.get("/clientes", async (req, res) => {
    const user = req.user

    if (user == undefined) {
        res.redirect("/login")

    } else {
        const userId = req.user.id
        const projetos = await getProjectFromClient(userId)
        res.render("cliente.ejs", { user: user, projetos: projetos })
    }

})

app.get("/detalhes-de-projeto/:id", async (req, res) => {
    const projectId = req.params.id
    const user = req.user
    if (user == undefined) {
        res.redirect("/clientes")
    } else {
        const checkRightUser = await getRelationships(user.id, projectId)

        if (checkRightUser == true) {
            const result = await getDbProject(projectId)
            const projeto = result[0]
            const array = await getDocuments(projectId)
            const imagens = array.arrayImagens.map((element) => element.link)
            const spreadsheet = array.arraySpreadsheet.map((element) => element.link)
            const documentos = array.arrayDocumentos.map((element) => element.link)
            const arquivos = array.arrayArquivos.map((element) => element.link)
            res.render("detalhado.ejs", { user: user, projeto: projeto, imagens: imagens, documentos: documentos, spreadsheet: spreadsheet, arquivos: arquivos })

        } else {
            res.redirect("/clientes")

        }


    }




})

app.get("/json/:natureza", async (req, res) => {
    const id = req.query.id
    switch (req.params.natureza) {
        case 'user':
            const result = await getDbUsers(id)
            res.json({ dado: result[0] })
            break;
        case 'orcamentos':
            const result_orc = await getDbOrcamentos(id)
            res.json({ dado: result_orc[0] })
            break;
        default:
            res.json({ dado: 'Nenhum dado encontrado' })
            break;
    }
})


// POST

//login
app.post(
    "/login",
    passport.authenticate("local", {
        failureRedirect: "/login",
        successRedirect: "/redirect",
        failureMessage: true
    }))
//registro usuario
app.post("/register", async (req, res) => {
    const dn = new Date(req.body.dn)
    console.log(req.body, dn)

    try {
        const result = await getDbUsers(req.body.email);
        if (result.length > 0) {
            res.render("login.ejs", { mensagem: "Usuario Cadastrado, tente fazer login" })
        } else {
            bcrypt.hash(req.body.password, saltRounds, async (err, hash) => {
                if (err) {
                    console.log("Erro ao criptografar senha" + err)
                    res.send("Algum erro aconteceu")
                } else {
                    await db.query("INSERT INTO usuarios (nome,sobrenome,nascimento,sexo,senha,email,administrador,verificado) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                        [
                            req.body.nome, req.body.sobrenome, req.body.dn, req.body.sexo, hash, req.body.email, false, false
                        ])
                    console.log("query succefull")
                    res.render("login.ejs", { mensagem: "Usuario registrado com sucesso, faça login" })
                }

            })

        }

    } catch (error) {
        console.log(error)
        res.send("Algum erro aconteceu")

    }


});
///editar usuario
app.post("/updateUser/:id", async (req, res,) => {
    const id = req.params.id
    await queryUpdate("admninistrador", req.body.administrador, id)
    await queryUpdate("verificado", req.body.verificado, id)

    async function queryUpdate(coluna, valor, id) {
        try {
            switch (coluna) {
                case 'admninistrador':
                    await db.query('UPDATE usuarios SET administrador = ($1) WHERE id = ($2);', [valor, id])
                    break;
                case 'verificado':
                    await db.query('UPDATE usuarios SET verificado = ($1) WHERE id = ($2);', [valor, id])
                    break;
                default:
                    console.log("algo de errado na função queryUpdate")
                    break;
            }

        } catch (error) {
            console.log("Algum erro aconteceu na query", error)
        }
    }

    res.redirect("/admin/usuarios");

});
//novo-projeto
app.post("/projeto-novo", async (req, res) => {
    // const teste = {
    //     id_cliente: '13',
    //     nome_cliente: 'Maria ',
    //     sobrenome_cliente: 'Alice',
    //     dn: '2000-10-25',
    //     sexo: 'Feminino',
    //     email: 'maria@gmail.com',
    //     tel: '31999108076',
    //     nome_projeto: 'Casa da José Alfredo',
    //     cidade: 'BH',
    //     endereco: 'Rua Rio Grande do Norte, 916, Savassi',
    //     tipo_estabelecimento: 'residencial',
    //     padrao_estabelecimento: 'normal',
    //     valor_orcamento: '4388',
    //     valor_est_obra: '35000000',
    //     etapa0: 'Pré liminar',
    //     prazo_etapa0: '2024-12-08',
    //     etapa1: 'Final',
    //     prazo_etapa1: '2024-12-08',
    //     data_projeto: '2024-11-08'
    // }
    // let awnser = req.body
    let awnser = req.body

    //checar se cliente já registrado, se não adicionar cliente.
    if (awnser.id_cliente == '') {
        try {
            const response = await db.query("INSERT INTO usuarios (nome,sobrenome,nascimento,sexo,email,tel,administrador) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [awnser.nome_cliente, awnser.sobrenome_cliente, awnser.dn, awnser.sexo, awnser.email, awnser.tel, false])
            const rows = response.rows[0]
            const newID = rows.id
            awnser.id_cliente = newID
            console.log(`Adiconado cliente,${newID}`)
            await step2(newID)

        } catch (error) {
            console.log(error, "Erro na query de inserir os clientes")
        }
    } else {
        console.log(`Cliente existente,${awnser.id_cliente}`)
        await step2(awnser.id_cliente)
    }

    async function step2(newID) {
        const arrayOfResults = [awnser.nome_projeto, awnser.endereco, awnser.valor_orcamento, awnser.tipo_estabelecimento, false, "Em andamento", awnser.valor_est_obra, awnser.data_projeto, awnser.cidade, awnser.padrao_estabelecimento];
        ///adionar projeto a base de projetos
        try {
            const response = await db.query("INSERT INTO projetos (nome,endereco,orcamento,finalidade,display,status,custo_obra,data_projeto,cidade,padrao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id", arrayOfResults)
            const rows = response.rows[0]
            const projectId = rows.id
            ///relacionando cliente a projeto
            await step3(projectId, newID);
            ///inserindo etapas em outra tabela
            await step4(projectId)

        } catch (error) {
            console.log("Erro na query do projeto", error)

        }

    }

    ///fazer relation cliente/projeto
    async function step3(projectId, newID) {
        try {
            db.query("INSERT INTO relation_table (client_id,project_id) VALUES ($1,$2)", [newID, projectId])
            console.log("Relação registrada")
        } catch (error) {
            console.log("erro na query das relacoes", error)

        }
        res.redirect("/admin/projetos")
    }

    async function step4(project_id) {
        const keys = Object.keys(awnser)
        const filter = keys.filter((elem, index) => elem.includes('etapa'));
        const map = filter.sort()
        const map1 = map.slice(0, (filter.length) / 2)
        for (let i = 0; i < map1.length; i++) {
            let elem = map1[i]
            let nome_etapa = awnser[elem]
            let nome_prazo = `prazo_etapa${i}`
            let prazo_etapa = awnser[nome_prazo]
            try {
                await db.query('INSERT INTO etapas (nome_etapa,prazo,project_id,status) VALUES ($1,$2,$3,$4)', [nome_etapa, prazo_etapa, project_id, "Em aberto"])
                console.log(`Adiocinado etapas ${nome_etapa}`)

            } catch (error) {
                console.log(error, "erro ao inserir etapas")

            }
        }
    }
})

app.post("/editar-projeto", async (req, res) => {
    const awnser = req.body
    console.log(awnser)
    try {
        await db.query("UPDATE projetos SET nome = $1,endereco =$2,orcamento=$3,finalidade=$4,display=$5,ativo=$6,custo_obra=$7 WHERE id = $8", [awnser.nome, awnser.endereco, awnser.orcamento, awnser.finalidade, awnser.display, awnser.ativo, awnser.custo_obra, awnser.id])
    } catch (error) {
        res.send("Algum erro aconteceu na query")
        console.log("erro ao inserir query", error)
    }

    res.redirect("/admin/projetos")

})

app.post("/editar-orcamento/:id", async (req, res) => {
    const id = req.params.id
    const status = req.body.status

    try {
        await db.query("UPDATE orcamentos SET status = $1 WHERE id = $2", [status, id])

    } catch (error) {
        res.send("Algum erro aconteceu na query")
        console.log("erro ao inserir query", error)

    }
    res.redirect("/admin/orcamentos")
})

app.post("/link-add", async (req, res) => {
    const awnser = req.body;
    const id = parseInt(req.body.id);
    awnser.nomelink.forEach((element, index) => {
        try {
            db.query("INSERT INTO documentos (project_id,link,type,nome,obs) VALUES ($1,$2,$3,$4,$5)", [id, awnser.link[index], awnser.type[index], element, awnser.obslink[index] ? awnser.obslink[index] : null])

        } catch (error) {
            console.log(error, "erro ao adicionar link na db")
            res.send("Algum erro aconteceu, contate suporte")

        }
    });
    res.redirect("/admin/home")
})

app.post("/client-add", async (req, res) => {
    const client_id = parseInt(req.body.cliente)
    const project_id = parseInt(req.body.project_id)
    if (await getRelationships(client_id, project_id)) {
        console.log("Relação já registrada")
    } else {
        try {
            db.query("INSERT INTO relation_table (client_id,project_id) VALUES ($1,$2)", [client_id, project_id])
        } catch (error) {
            res.send("Algum erro aconteceu na query")
            console.log("erro ao inserir query", error)
        }
    }
    res.redirect("/admin/home")

})

app.post("/novo-orcamento", async (req, res) => {
    const form = req.body;
    //checar quantos ambientes tem e incluir vazio se não tiver
    const checkAmb = ['a_0_nome', 'a_0_m2', 'a_0_preco', 'a_1_nome', 'a_1_m2', 'a_1_preco',
        'a_2_nome', 'a_2_m2', 'a_2_preco', 'a_3_nome', 'a_3_m2', 'a_3_preco',
        'a_4_nome', 'a_4_m2', 'a_4_preco', 'a_5_nome', 'a_5_m2', 'a_5_preco',
        'a_6_nome', 'a_6_m2', 'a_6_preco', 'a_7_nome', 'a_7_m2', 'a_7_preco',
        'a_8_nome', 'a_8_m2', 'a_8_preco', 'a_9_nome', 'a_9_m2', 'a_9_preco',
        'a_10_nome', 'a_10_m2', 'a_10_preco'
    ]
    // for loop p adicionar ambientes não incluidos
    for (let i = 0; i < checkAmb.length; i++) {
        let name = checkAmb[i]
        if (form.hasOwnProperty(name)) {
            // já existe, nada a se fazer então.
        } else {
            form[name] = null
            //se não existe, acrescentar e incluir valor nulo.
        }

    }

    //incluindo status em aberto a novos orçamentos

    form['status'] = 'Em aberto'
    //fiquei com preguiça e coloquei 5 ambientes somente.
    const arrayOfResults = [form.nome_cliente, form.sobrenome_cliente, form.dn, form.sexo, form.email, form.tel, form.nome_projeto, form.cidade, form.endereco, form.total, form.data, form.a_0_nome, form.a_0_m2, form.a_0_preco, form.a_1_nome, form.a_1_m2, form.a_10_preco, form.a_2_nome, form.a_2_m2, form.a_2_preco, form.a_3_nome, form.a_3_m2, form.a_3_preco, form.a_4_nome, form.a_4_m2, form.a_4_preco, form.a_5_nome, form.a_5_m2, form.a_5_preco, form.status]

    try {
        const id = db.query("INSERT INTO orcamentos (nome_cliente, sobrenome_cliente, dn, sexo, email, tel, nome_projeto, cidade, endereco, total, data, a_0_nome, a_0_m2, a_0_preco, a_1_nome, a_1_m2, a_1_preco, a_2_nome, a_2_m2, a_2_preco, a_3_nome, a_3_m2, a_3_preco, a_4_nome, a_4_m2, a_4_preco, a_5_nome, a_5_m2, a_5_preco,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)", arrayOfResults)

    } catch (error) {
        console.log("erro na query" + error)

    }
    res.redirect("/admin/home")
})

app.post("/atualizar-etapas/:id", async (req, res) => {
    const id = req.params.id
    const status = req.body.status
    const url = req.header('Referer');
    try {
        await db.query("UPDATE etapas SET status =$1 WHERE id = $2",[status,id])

    } catch (error) {
        console.log(error,"Erro ao atualizar etapas")

    }
    res.redirect(url)
})

//autentication

//local
passport.use(
    "local",
    new Strategy(async function verify(username, password, cb) {
        const result = await getDbUsersLogin(username);
        if (result.length > 0) {
            const user = result[0]
            const storedHashedPassword = user.senha;
            bcrypt.compare(password, storedHashedPassword, (err, valid) => {
                if (err) {
                    console.log("Erro ao comparar senhas", err);
                    return cb(err, { mensagem: "usuario ou senha incorretas" });
                } else {
                    if (valid) {
                        return cb(null, user);
                    } else {
                        return cb(null, false)

                    }
                }
            })

        } else {
            console.log("Usuario não cadastrado")
            return cb(null, false, { mensagem: "Usuario ou senha incorreta" })
        }


    })

)


//serialize e deserialize
passport.serializeUser((user, cb) => {
    cb(null, user);
});

passport.deserializeUser((user, cb) => {
    cb(null, user);
});


///basic functions
app.get("/teste", async (req, res) => {
    const teste = {
        id_cliente: '13',
        nome_cliente: 'Maria ',
        sobrenome_cliente: 'Alice',
        dn: '2000-10-25',
        sexo: 'Feminino',
        email: 'maria@gmail.com',
        tel: '31999108076',
        nome_projeto: 'Casa do Marcelo',
        cidade: 'BH',
        endereco: 'Rua Rio Grande do Norte, 916, Savassi',
        tipo_estabelecimento: 'residencial',
        padrao_estabelecimento: 'normal',
        valor_orcamento: '4388',
        valor_est_obra: '35000000',
        etapa0: 'Pré liminar',
        prazo_etapa0: '2024-12-08',
        etapa1: 'Final',
        prazo_etapa1: '2024-12-08',
        etapa2: 'Final',
        prazo_etapa2: '2024-12-08',
        data_projeto: '2024-11-08'
    }

    let awnser = teste
    step4(1)

    async function step4(project_id) {
        const keys = Object.keys(awnser)
        const filter = keys.filter((elem, index) => elem.includes('etapa'));
        const map = filter.sort()
        const map1 = map.slice(0, (filter.length) / 2)
        console.log(awnser.etapa0)
        for (let i = 0; i < map1.length; i++) {
            console.log(i, map1[i])
            let elem = map1[i]
            let nome_etapa = awnser[elem]
            let nome_prazo = `prazo_etapa${i}`
            let prazo_etapa = awnser[nome_prazo]
            console.log(nome_etapa, nome_prazo, prazo_etapa)

            // try {
            //     await db.query('INSERT INTO etapas (nome_etapa,prazo,project_id,status) VALUES ($1,$2,$3,$4)',[nome_etapa,prazo_etapa,project_id,"Em aberto"])

            // } catch (error) {
            //     console.log(error,"erro ao inserir etapas")

            // }
        }
    }
    res.sendStatus(200)
})

// Basic functions

async function getDbUsersLogin(name) {
    const result = await db.query("SELECT * FROM usuarios WHERE email = $1", [name]);
    return result.rows
}

async function getDbUsers(id) {
    if (id == undefined) {
        const result = await db.query("SELECT * FROM usuarios")
        return result.rows
    } else {
        const result = await db.query("SELECT * FROM usuarios WHERE id = $1", [id]);
        return result.rows
    }
}

async function getDbProject(name) {
    if (name == undefined) {
        const result = await db.query("SELECT * FROM projetos")
        return result.rows
    } else {
        const result = await db.query("SELECT * FROM projetos WHERE id = $1", [name]);
        return result.rows
    }
}

async function getDbEtapas(project_id) {
    if (project_id == null) {
        const result = await db.query("SELECT etapas.*,projetos.nome FROM etapas INNER JOIN projetos ON etapas.project_id = projetos.id WHERE etapas.status = 'Em aberto'")
        const array = result.rows
        array.forEach((elem) => {
            let today = new Date()
            let prazo = new Date(elem.prazo)
            let diff = prazo - today
            const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
            elem['dpe'] = diffDays
        })
        return array
    } else {
        try {
            const result = await db.query("SELECT * FROM etapas WHERE project_id = $1", [project_id])
            const array = result.rows
            array.forEach((elem) => {
                let today = new Date()
                let prazo = new Date(elem.prazo)
                let diff = prazo - today
                const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
                elem['dpe'] = diffDays
            })
            return array

        } catch (error) {
            console.log(error, "Erro ao buscar etapas")
        }
    }


}

async function getDbOrcamentos(status) {
    if (status == 'Em aberto') {
        const result = await db.query("SELECT * FROM orcamentos WHERE status = 'Em aberto'")
        const array = result.rows
        array.forEach((elem) => {
            let today = new Date()
            let data = new Date(elem.data)
            let diff = today - data
            const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
            elem['dsr'] = diffDays
        })
        return array

    } else {
        const result = await db.query("SELECT * FROM orcamentos WHERE id=$1", [status]);
        return result.rows
    }
}

async function getRelationships(cliente, projeto) {
    const result = await db.query("SELECT * FROM relation_table WHERE client_id = $1 AND project_id = $2", [cliente, projeto])
    if (result.rowCount == 0) {
        return false
    } else {
        return true
    }
}

async function getProjectFromClient(client) {
    const result = await db.query("SELECT * from projetos INNER JOIN relation_table ON relation_table.project_id = projetos.id WHERE client_id = $1", [client])
    return result.rows

}

async function getDocuments(projectID) {
    try {
        const result = await db.query("SELECT * from documentos WHERE project_id = $1", [projectID])
        const array = result.rows
        const imagens = array.filter((element) => element.type == "imagens")
        const documentos = array.filter((element) => element.type == "documentos")
        const arquivos = array.filter((element) => element.type == "arquivos")
        const spreadsheet = array.filter((element) => element.type == "spreadsheet")

        return {
            arrayImagens: imagens,
            arrayDocumentos: documentos,
            arraySpreadsheet: spreadsheet,
            arrayArquivos: arquivos
        }

    } catch (error) {
        console.log("Erro na query" + error)
    }


}



/// listen
app.listen(port, () => {
    console.log(`Servidor funcionando na porta ${port}`)
})


