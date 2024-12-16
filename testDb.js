import pg from 'pg'
const { Client } = pg

const client = new Client({
  user: 'jlawebsite_user',
  password: 'UbAnnQQDKHphXHCEKYqmhg0FEHqAx8gG',
  host: 'postgresql://jlawebsite_user:UbAnnQQDKHphXHCEKYqmhg0FEHqAx8gG@dpg-ctg7opl6l47c73d8s720-a.oregon-postgres.render.com/jlawebsite' ,
  port: "5432",
  database: 'jlawebsite',
})


await client.connect()