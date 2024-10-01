import express from "express";
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
        cookie:{
            maxAge: 1000*60*60*24
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
    if(req.user){
        switch (req.user.administrador) {
            case true:
            res.redirect("/admin/home")
            break;
            default:
            res.redirect("/clientes")
            break;
        }
        
    }else{
        res.render("login.ejs");
    }

});

app.get("/register",(req,res)=>{
    res.render("register.ejs")
});

app.get("/redirect",(req,res)=>{
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

app.get("/admin/:route",async (req,res)=>{
    const endPoint = req.params.route;
    const user = await getDbUsers();
    const  projetos =  await getDbProject()
    switch(endPoint){
        case "usuarios":
        res.render("admin.ejs",{user:user})
        break;
        case "projetos": 
        res.render("admin.ejs",{projetos:projetos,users:user})
        break;
        case "edit":
        const id = req.query.id
        let result = await getDbProject(id)
        let projeto = result[0]
        const array = await getDocuments(id)
        const users =user.map((element)=>({nome:element.nome + " " +element.sobrenome,id:element.id}))
        res.render("edit.ejs",{projeto:projeto,users:users,documentos:array})
        break;
        case "orcamentos":
        res.render("orcamento.ejs")
        break;
        case "home": res.render("admin.ejs")
        break;
        default:
        res.redirect("/admin/home")
        console.log("Algo de errado com parametros")
    }
})

app.get("/clientes",async (req,res)=>{
    const user = req.user
   
    if (user == undefined) {
        res.redirect("/login")
        
    } else {
        const userId = req.user.id
        const projetos = await getProjectFromClient (userId)
        res.render("cliente.ejs",{user:user,projetos:projetos})
    }
    
})

app.get("/detalhes-de-projeto/:id",async (req,res)=>{
    const projectId = req.params.id
    const user =  req.user
    if (user == undefined) {
        res.redirect("/clientes")
    } else {
        const checkRightUser = await getRelationships(user.id,projectId)
  
        if (checkRightUser == true) {
            const result = await getDbProject (projectId)
            const projeto = result[0]
            const array = await getDocuments(projectId)
            const imagens = array.arrayImagens.map((element)=>element.link)
            const spreadsheet = array.arraySpreadsheet.map((element)=>element.link)
            const documentos = array.arrayDocumentos.map((element)=>element.link)
            const arquivos = array.arrayArquivos.map((element)=>element.link)
            res.render("detalhado.ejs",{user:user,projeto:projeto,imagens:imagens,documentos:documentos,spreadsheet:spreadsheet,arquivos:arquivos})
            
        } else {
            res.redirect("/clientes")
            
        }
        
        
    }


   

})



// app.get("/projetos/:id", (req, res) => {
//     res.send("Ok")
//     });



//post request

app.post(
    "/login",
    passport.authenticate("local", {
        failureRedirect: "/login",
        successRedirect:"/redirect",
        failureMessage:true 
    })) 
    
    // app.post("/login", (req,res)=>{
    //     console.log(req.body)
    //     res.sendStatus(200)
    // })
    
    app.post("/register",async (req,res)=> {
        const dn = new Date(req.body.dn)
        console.log(req.body,dn)
        
        try {
            const result = await getDbUsers(req.body.email);
            if (result.length > 0) {
                res.render("login.ejs",{mensagem:"Usuario Cadastrado, tente fazer login"})
            } else {
                bcrypt.hash(req.body.password,saltRounds,async(err,hash)=>{
                    if(err){
                        console.log("Erro ao criptografar senha" +err)
                        res.send("Algum erro aconteceu")
                    }else{
                        await db.query("INSERT INTO usuarios (nome,sobrenome,nascimento,sexo,senha,email,administrador,verificado) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                        [
                            req.body.nome,req.body.sobrenome, req.body.dn,req.body.sexo,hash,req.body.email,false,false
                        ])
                        console.log("query succefull")
                        res.render("login.ejs",{mensagem:"Usuario registrado com sucesso, faça login"})
                    }
                    
                })
                
            }        
            
        } catch (error) {
            console.log(error)
            res.send("Algum erro aconteceu")
            
        }
        
        
    });
    
    app.post("/updateUser/:id",async (req,res,)=>{
        const id = req.params.id
        await queryUpdate("admninistrador",req.body.administrador,id)
        await queryUpdate("verificado",req.body.verificado,id)
        
        async function queryUpdate (coluna, valor,id){
            try {
                switch (coluna) {
                    case 'admninistrador':
                    await db.query('UPDATE usuarios SET administrador = ($1) WHERE id = ($2);',[valor,id])
                    break;
                    case 'verificado':
                    await db.query('UPDATE usuarios SET verificado = ($1) WHERE id = ($2);',[valor,id])
                    break;
                    default:
                    console.log("algo de errado na função queryUpdate")
                    break;
                }
                
            } catch (error) {
                console.log("Algum erro aconteceu na query",error)        
            }
        }
        
        res.redirect("/admin/usuarios");  
        
    });

    app.post("/projeto-novo",async(req,res)=>{
        const awnser = req.body
        try {
            await db.query("INSERT INTO projetos (nome,endereço,orcamento,finalidade,display,ativo,custo_obra) VALUES ($1,$2,$3,$4,$5,$6,$7)",[awnser.nome,awnser.endereco,awnser.orcamento,awnser.finalidade,awnser.display,awnser.ativo,awnser.custo_obra])            
        } catch (error) {
            res.send("Algum erro aconteceu na query")
            console.log("erro ao inserir query",error)
        }
        res.redirect("/admin/projetos")

    })

    app.post("/editar-projeto",async(req,res)=>{
        const awnser = req.body
        console.log(awnser)
        try {
            await db.query("UPDATE projetos SET nome = $1,endereco =$2,orcamento=$3,finalidade=$4,display=$5,ativo=$6,custo_obra=$7 WHERE id = $8",[awnser.nome,awnser.endereco,awnser.orcamento,awnser.finalidade,awnser.display,awnser.ativo,awnser.custo_obra,awnser.id])            
        } catch (error) {
            res.send("Algum erro aconteceu na query")
            console.log("erro ao inserir query",error)
        }

        res.redirect("/admin/projetos")

    })
    
    app.post("/link-add",async (req,res)=>{
        const awnser = req.body;
        const id =parseInt(req.body.id);
        awnser.nomelink.forEach((element,index) => {
            try {
                db.query("INSERT INTO documentos (project_id,link,type,nome,obs) VALUES ($1,$2,$3,$4,$5)",[id,awnser.link[index],awnser.type[index],element,awnser.obslink[index]?awnser.obslink[index]:null])
                
            } catch (error) {
                console.log(error,"erro ao adicionar link na db")
                res.send("Algum erro aconteceu, contate suporte")
                
            }            
        });
        res.redirect("/admin/home")
    })

    app.post("/client-add",async (req,res)=>{
        const client_id = parseInt(req.body.cliente)
        const project_id = parseInt(req.body.project_id)
        if ( await getRelationships(client_id,project_id)) {
            console.log("Relação já registrada")
        } else {
            try {
                db.query("INSERT INTO relation_table (client_id,project_id) VALUES ($1,$2)",[client_id,project_id])
            } catch (error) {
                res.send("Algum erro aconteceu na query")
                console.log("erro ao inserir query",error)
            }
        }
        res.redirect("/admin/home")

    })

    ///post request orçamento

    app.post("/novo-orcamento",async(req,res)=>{
        console.log(req.body)
        let resumo = req.body
        // Fazer query depois
        res.render("resumo-orcamento.ejs",{resumo:resumo})
    

    })
    
    
    //autentication
    
    //local
    passport.use(
        "local",
        new Strategy (async function verify (username,password,cb){
            const result = await getDbUsers(username);
            if (result.length > 0) {
                const user = result[0]
                const storedHashedPassword = user.senha;
                bcrypt.compare(password,storedHashedPassword,(err,valid)=>{
                    if (err) {
                        console.log("Erro ao comparar senhas",err);
                        return cb(err,{mensagem:"usuario ou senha incorretas"});                   
                    } else {
                        if (valid) {
                            return cb(null,user);
                        } else {
                            return cb (null,false)
                            
                        }                   
                    }
                })
                
            } else {
                console.log("Usuario não cadastrado")
                return cb(null,false,{mensagem:"Usuario ou senha incorreta"})
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
    app.get("/teste", async(req,res)=>{
        let user = req.user
        console.log(user)
        res.render("admin.ejs")

    
    })
    
    // Basic functions
    
    async function getDbUsers(name){
        if (name == undefined) {
            const result = await db.query("SELECT * FROM usuarios")
            return result.rows
        } else {
            const result = await db.query("SELECT * FROM usuarios WHERE email = $1",[name]);
            return result.rows
        }
    }
    
    async function getDbProject(name){
        if (name == undefined) {
            const result = await db.query("SELECT * FROM projetos")
            return result.rows
        } else {
            const result = await db.query("SELECT * FROM projetos WHERE id = $1",[name]);
            return result.rows
        }
    }

    async function getRelationships(cliente,projeto){
        const result = await db.query("SELECT * FROM relation_table WHERE client_id = $1 AND project_id = $2",[cliente,projeto])
        if(result.rowCount == 0){
            return false
        }else{
            return true
        }
    }

    async function getProjectFromClient (client){
        const result = await db.query("SELECT * from projetos INNER JOIN relation_table ON relation_table.project_id = projetos.id WHERE client_id = $1",[client])
        return result.rows

    }
    
    async function getDocuments (projectID){
        try {
            const result = await db.query("SELECT * from documentos WHERE project_id = $1",[projectID])
            const array = result.rows
            const imagens = array.filter((element) =>element.type == "imagens" )
            const documentos = array.filter((element) =>element.type == "documentos" )
            const arquivos = array.filter((element) =>element.type == "arquivos" )
            const spreadsheet = array.filter((element) =>element.type == "spreadsheet" )

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
    app.listen(port,()=>{
        console.log(`Servidor funcionando na porta ${port}`)
    })
    
    
    