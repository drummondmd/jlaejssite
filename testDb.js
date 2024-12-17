import pg from 'pg'

const connectionStringExternal = 'postgresql://jlawebsite_user:UbAnnQQDKHphXHCEKYqmhg0FEHqAx8gG@dpg-ctg7opl6l47c73d8s720-a.oregon-postgres.render.com/jlawebsite'

const client = new pg.Client({connectionString:connectionStringExternal,ssl:true})

await client.connect();

console.log("teste");

export default connectionStringExternal;