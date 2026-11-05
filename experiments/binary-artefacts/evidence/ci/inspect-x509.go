// Independent X.509 extension inspection with Go's encoding/asn1 and crypto/x509 (no OpenSSL, no GnuTLS).
//
//	go run inspect-x509.go cert.pem [...]
package main

import (
	"crypto/x509"
	"encoding/asn1"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
)

type ext struct {
	ID       asn1.ObjectIdentifier
	Critical bool `asn1:"optional"`
	Value    []byte
}
type tbs struct {
	Raw        asn1.RawContent
	Version    int `asn1:"optional,explicit,default:0,tag:0"`
	Serial     *big.Int
	SigAlg     asn1.RawValue
	Issuer     asn1.RawValue
	Validity   asn1.RawValue
	Subject    asn1.RawValue
	SPKI       asn1.RawValue
	IssuerUID  asn1.BitString `asn1:"optional,tag:1"`
	SubjectUID asn1.BitString `asn1:"optional,tag:2"`
	Exts       []ext          `asn1:"optional,explicit,tag:3"`
}
type cert struct {
	TBS    tbs
	SigAlg asn1.RawValue
	Sig    asn1.BitString
}

func main() {
	for _, f := range os.Args[1:] {
		b, _ := os.ReadFile(f)
		p, _ := pem.Decode(b)
		if p == nil {
			fmt.Println(f, "no PEM block")
			continue
		}
		var c cert
		if _, err := asn1.Unmarshal(p.Bytes, &c); err != nil {
			fmt.Println(f, "asn1:", err)
			continue
		}
		seen := map[string]int{}
		fmt.Printf("%s: %d extensions:", f, len(c.TBS.Exts))
		for _, e := range c.TBS.Exts {
			seen[e.ID.String()]++
			fmt.Printf(" %s%s", e.ID, map[bool]string{true: "(crit)", false: ""}[e.Critical])
		}
		fmt.Println()
		for id, n := range seen {
			if n > 1 {
				fmt.Printf("  DUPLICATE %s x%d\n", id, n)
			}
		}
		if _, err := x509.ParseCertificate(p.Bytes); err != nil {
			fmt.Println("  crypto/x509:", err)
		} else {
			fmt.Println("  crypto/x509: parsed")
		}
	}
}
